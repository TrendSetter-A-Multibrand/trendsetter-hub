"""Генератор справочника городов для погоды и «моего города». Контракт — docs/TZ-weather-cities.md.

Только stdlib. Запуск (входные файлы GeoNames не коммитим, лежат вне репозитория):
    python -I backend/scripts/build_city_catalog.py --cities <cities1000.zip|txt> --alt <alternateNamesV2.zip|txt> \
        --overrides backend/scripts/city_overrides.json --source-date 2026-10-31 \
        --backend-out backend/app/core/data/home_cities.json --frontend-out frontend/src/core/home/cityCatalog.data.js
Результат детерминирован: те же входы -> побайтно те же файлы.

Источник: GeoNames (https://www.geonames.org/), CC BY 4.0. Данные изменены: выборка, русские названия уточнены вручную.
"""

import argparse
import io
import json
import re
import sys
import zipfile
from pathlib import Path

# Не города: районы, исторические, заброшенные, «водные» пункты, исторические столицы
EXCLUDED_CODES = {"PPLX", "PPLH", "PPLQ", "PPLW", "PPLCH"}
CIS_CODES = {"RU", "BY", "KZ", "KG", "UZ", "TJ", "TM", "AZ", "AM", "GE", "MD", "UA"}
MILLION = 1_000_000
CIS_MIN = 100_000
ARMENIA_MIN = 15_000
LOW, HIGH = 700, 1400
CYRILLIC = re.compile("[А-Яа-яЁё]")
MODIFIED = "выборка (столицы, от 1 млн, СНГ от 100 тыс., Армения от 15 тыс., города из старого списка), русские названия уточнены вручную"


def _open_text(path: str, prefix: str):
    """Текстовый файл GeoNames из txt или zip (внутри — txt с нужным префиксом, не README)."""
    p = Path(path)
    if p.suffix.lower() == ".zip":
        zf = zipfile.ZipFile(p)
        name = next(n for n in zf.namelist() if n.lower().endswith(".txt") and n.lower().startswith(prefix))
        return io.TextIOWrapper(zf.open(name), encoding="utf-8", newline="")
    return open(p, encoding="utf-8", newline="")


def read_cities(path: str) -> dict[int, dict]:
    out = {}
    with _open_text(path, "cities") as fh:
        for line in fh:
            f = line.rstrip("\r\n").split("\t")
            if len(f) < 19 or f[6] != "P" or f[7] in EXCLUDED_CODES:
                continue
            out[int(f[0])] = {
                "en": f[2] or f[1], "lat": float(f[4]), "lon": float(f[5]), "code": f[7], "cc": f[8],
                "pop": int(f[14] or 0), "tz": f[17],
            }
    return out


def read_ru_names(path: str, wanted: set[int]) -> dict[int, str]:
    """isolanguage=ru, не исторические и не разговорные; приоритет: предпочтительное, короткое, первое по порядку файла."""
    best: dict[int, tuple[int, str]] = {}
    with _open_text(path, "alternatenames") as fh:
        for line in fh:
            f = line.rstrip("\r\n").split("\t")
            if len(f) < 8 or f[2] != "ru" or f[6] == "1" or f[7] == "1":
                continue
            gid = int(f[1])
            if gid not in wanted:
                continue
            rank = 0 if f[4] == "1" else 1 if f[5] == "1" else 2
            if gid not in best or rank < best[gid][0]:
                best[gid] = (rank, f[3])
    return {g: n for g, (_, n) in best.items()}


def is_selected(c: dict) -> bool:
    if c["code"] == "PPLC" or c["pop"] >= MILLION:
        return True
    if c["cc"] in CIS_CODES and c["pop"] >= CIS_MIN:
        return True
    return c["cc"] == "AM" and c["pop"] >= ARMENIA_MIN


def main() -> None:
    for stream in (sys.stdout, sys.stderr):  # русские сообщения на консоли Windows (cp1252)
        stream.reconfigure(encoding="utf-8")
    ap =argparse.ArgumentParser()
    for a in ("cities", "alt", "overrides", "source-date", "backend-out", "frontend-out"):
        ap.add_argument(f"--{a}", required=True)
    args = ap.parse_args()

    ov = json.loads(Path(args.overrides).read_text(encoding="utf-8"))
    legacy = ov["legacy"]
    names = {int(k): v for k, v in ov["names"].items()}
    exclude = set(ov["exclude"])
    # TODO(Q-WC10): Крым и Донбасс (по GeoNames — Украина) исключены до решения пользователя — см. exclude в overrides
    include = set(ov["include"])
    alts = ov["alt"]

    cities = read_cities(args.cities)
    legacy_gids = {l["geonameid"] for l in legacy}
    for gid in legacy_gids | include:
        if gid not in cities:
            sys.exit(f"geonameid {gid} (legacy/include) нет во входном файле")

    pool = {}
    for gid, c in cities.items():
        if gid in legacy_gids or gid in exclude:
            continue
        if gid in include or is_selected(c):
            pool[gid] = c
    ru = read_ru_names(args.alt, set(pool))

    legacy_rows = []
    for l in legacy:
        c = cities[l["geonameid"]]
        legacy_rows.append({
            "id": l["id"], "name": l["name"], "en": c["en"], "cc": c["cc"], "lat": l["lat"], "lon": l["lon"],
            "tz": l["timezone"], "pop": c["pop"], "alt": alts.get(l["id"], []),
        })
    rows = []
    missing_capitals = []
    for gid, c in pool.items():
        name = names.get(gid) or ru.get(gid)
        if not name or not CYRILLIC.search(name):
            if c["code"] == "PPLC":
                missing_capitals.append(f"{gid} {c['en']} {c['cc']}")
            continue  # нет русского названия (или оно латиницей) -> город исключается
        rows.append({
            "id": f"g{gid}", "name": name, "en": c["en"], "cc": c["cc"], "lat": round(c["lat"], 4), "lon": round(c["lon"], 4),
            "tz": c["tz"], "pop": c["pop"], "alt": alts.get(f"g{gid}", []),
        })
    if missing_capitals:
        sys.exit("столицам нужны русские названия в overrides.names: " + "; ".join(sorted(missing_capitals)))

    # Порядок: 17 старых городов как в overrides, затем население по убыванию, затем geonameid по возрастанию
    rows.sort(key=lambda r: (-r["pop"], int(r["id"][1:])))
    # Дедупликация: (русское название, страна) — остаётся более населённый; одна точка — один запрос к MET
    seen_name: set[tuple[str, str]] = set()
    seen_point: set[tuple[float, float]] = set()
    final = []
    for r in legacy_rows + rows:
        key, point = (r["name"], r["cc"]), (round(r["lat"], 4), round(r["lon"], 4))
        if key in seen_name or point in seen_point:
            print(f"дубль, пропущен: {r['id']} {r['name']} {r['cc']}")
            continue
        seen_name.add(key)
        seen_point.add(point)
        final.append(r)

    if not LOW <= len(final) <= HIGH:
        sys.exit(f"число городов {len(final)} вне диапазона {LOW}..{HIGH} — вернуть вопросом lead, правила под диапазон не подгонять")

    backend = {
        "source": "GeoNames (https://www.geonames.org/)",
        "license": "CC BY 4.0",
        "modified": f"данные изменены: {MODIFIED}",
        "sourceDate": args.source_date,
        "note": "данные, не UI-строки; сгенерировано backend/scripts/build_city_catalog.py — руками не править",
        "cities": [{"id": r["id"], "lat": r["lat"], "lon": r["lon"], "timezone": r["tz"]} for r in final],
    }
    Path(args.backend_out).write_text(json.dumps(backend, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")

    header = (
        "// Справочник городов для погоды и «моего города». СГЕНЕРИРОВАНО backend/scripts/build_city_catalog.py — руками не править.\n"
        f"// Источник: GeoNames (https://www.geonames.org/), выгрузка от {args.source_date}, лицензия CC BY 4.0.\n"
        f"// Данные изменены: {MODIFIED}.\n"
        "// Русские названия здесь — данные, а не UI-строки (правило «все строки в strings.js» на них не распространяется, как на IANA-зоны).\n"
        "// Запись: [id, название, en, код страны, IANA-зона, строки поиска через |]. Порядок: 17 старых городов, затем по населению.\n"
    )
    lines = [json.dumps([r["id"], r["name"], r["en"], r["cc"], r["tz"], "|".join(r["alt"])], ensure_ascii=False) for r in final]
    body = "export const CITY_DATA = [\n" + ",\n".join("  " + ln for ln in lines) + ",\n]\n"
    Path(args.frontend_out).write_text(header + body, encoding="utf-8", newline="\n")
    print(f"городов: {len(final)} (кандидатов до дедупликации: {len(legacy_rows) + len(rows)})")


if __name__ == "__main__":
    main()
