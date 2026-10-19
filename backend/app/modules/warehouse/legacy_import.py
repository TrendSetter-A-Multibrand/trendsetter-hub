"""Разовый перенос данных Склада из выгрузки xlsx старой системы «Склад-приемка» (Google Apps Script) в таблицы warehouse_*.

Запуск (разовая команда, к HTTP не подключается; в контейнере API, под пользователем hub_app):

  python -m app.modules.warehouse.legacy_import FILE|-            # сухой прогон (по умолчанию, ничего не пишет)
  python -m app.modules.warehouse.legacy_import FILE|- --apply    # запись
  python -m app.modules.warehouse.legacy_import FILE|- --tz Europe/Moscow
  python -m app.modules.warehouse.legacy_import --rollback        # откат последнего переноса, сухой прогон
  python -m app.modules.warehouse.legacy_import --rollback --apply

"-" — файл читается из stdin (docker exec -i ... < файл), в контейнер файл не копируется.
Весь перенос — одна транзакция; сухой прогон проходит тот же путь и в конце делает ROLLBACK.
Коды выхода: 0 — успех / чистый сухой прогон; 1 — ошибки файла; 2 — конфликт с данными БД или откат невозможен;
3 — сверка не сошлась. КИ в выводе и журнале только маской, полный код ЧЗ и почты не печатаются
(почты — только в списке «нет такого пользователя в хабе»).
"""
import argparse
import hashlib
import io
import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import BinaryIO
from zoneinfo import ZoneInfo

import openpyxl
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.core.audit import log_action
from app.db.database import get_engine
from app.modules.warehouse import service

SHEET_TZ = "Europe/Moscow"  # TODO(Q-M3): часовой пояс Google Таблицы; подтверждён пользователем (Москва), меняется флагом --tz
ACTION = "warehouse.legacy_import"
ACTION_ROLLBACK = "warehouse.legacy_import_rollback"
BATCH = 1000
S = "trendsetter_hub.warehouse_"

# Имена листов
SH_SUMMARY, SH_RECEIPTS, SH_PLANS, SH_COUNTERS, SH_SCANS = "Сводка", "Приемки", "Раскладки", "Счётчики", "Сканы"
SH_BOXES, SH_STORAGE, SH_ARCHIVE, SH_SECTIONS, SH_MARKS = "Короба", "Хранение", "Хранение — архив", "Секции", "Коды ЧЗ"
SH_PLAN_OLD = "Раскладка"  # не переносится; если не пуст — предупреждение

# Обязательные заголовки (строка 1). «Палет» в «Сканы» и «Короба» — формула, игнорируется.
H_RECEIPTS = ["Приемка", "Создана", "Кто создал", "Статус"]
H_PLANS = ["Приемка", "Версия", "Часть", "Данные", "Файл", "Загрузил", "Когда"]
H_COUNTERS = ["Счётчик", "Последний выданный номер"]
H_SCANS = ["ID", "Время", "Сотрудник", "Коробка", "ШК короба", "Баркод", "Статус", "Кто", "Приемка", "КИ Честный знак", "Код ЧЗ полностью"]
H_BOXES = ["ШК короба", "Сотрудник", "Коробка", "Товаров", "Открыт", "Закрыт", "Кто", "Приемка"]
H_STORAGE = ["Палет", "ШК короба", "Секция", "Палет №", "Штук в коробе", "Поставлен", "Сотрудник", "Кто", "Приемка", "Категория"]
H_ARCHIVE = H_STORAGE + ["Освобождён", "Кто освободил"]
H_SECTIONS = ["Категория", "Доп. секция", "Назначена", "Кто"]
H_MARKS = ["КИ", "GTIN", "Время", "Сотрудник", "Кто", "Приемка", "Коробка", "Код полностью", "Баркод"]

# Метрики Сводки: ключ представления warehouse_receipt_summary -> (заголовок листа «Сводка», подпись в отчёте)
METRICS = {
    "scanned": ("Отсканировано", "отсканировано"),
    "not_in_file": ("Нет в файле", "нет в файле"),
    "surplus": ("Излишек", "излишек"),
    "boxes_closed": ("Коробов закрыто", "коробов закрыто"),
    "boxes_without_pallet": ("Коробов без палета", "коробов без палета"),
    "pallets": ("Палетов хранения", "палетов"),
    "cz_codes": ("Кодов ЧЗ", "кодов ЧЗ"),
    "marked_without_cz": ("Маркированных без ЧЗ", "без ЧЗ"),
}

RECEIPT_STATUS = {"открыта": "open", "завершена": "finished"}
FINAL_BOX_RE = re.compile(r"^S[0-9A-Za-z-]+_K([0-9A-Za-z-]+)_P[1-6]_(\d+)$")
TEMP_BOX_RE = re.compile(r"^([0-9A-Za-z-]+)_(\d+)$")
SCAN_MS_RE = re.compile(r"^W-(\d{13})-")
DATE_FORMATS = ("%d.%m.%Y %H:%M:%S", "%d.%m.%Y %H:%M")
RECEIPT_TABLES = ("receipt_plans", "scans", "boxes", "storage_boxes", "storage_archive", "marks")
ALL_TABLES = ("receipts", "receipt_plans", "scans", "boxes", "storage_boxes", "storage_archive", "extra_sections", "marks", "box_counters", "pallet_pointers")


# ---------- преобразование значений ----------


def blank(v) -> bool:
    return v is None or (isinstance(v, str) and not v.strip())


def int_(v) -> int:
    if isinstance(v, bool):
        raise ValueError("ожидалось целое число")
    if isinstance(v, int):
        return v
    if isinstance(v, float) and v == v and v == int(v):
        return int(v)
    if isinstance(v, str) and v.strip().isdigit():
        return int(v.strip())
    raise ValueError("ожидалось целое число")


def text_(v, strip: bool = True) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v == v and v == int(v):
        return str(int(v))
    return str(v).strip() if strip else str(v)


def dt_(v, tz: ZoneInfo) -> datetime:
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=tz)
    if isinstance(v, date):
        return datetime(v.year, v.month, v.day, tzinfo=tz)
    if isinstance(v, str):
        for fmt in DATE_FORMATS:
            try:
                return datetime.strptime(v.strip(), fmt).replace(tzinfo=tz)
            except ValueError:
                pass
    raise ValueError("нечитаемая дата")


def mask_ki(ki: str) -> str:
    return (ki or "")[:16] + "…"


def _ms_to_dt(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)


def code_number(code: str) -> tuple[str, int] | None:
    """(категория, номер) из итогового S01_K03_P1_0015 или временного 03_0015 кода короба."""
    m = FINAL_BOX_RE.match(code) or TEMP_BOX_RE.match(code)
    return (service.part(m.group(1)), int(m.group(2))) if m else None


# ---------- чтение xlsx ----------


@dataclass
class Sheet:
    header: list
    rows: list  # (номер строки Excel, значения); полностью пустые строки отброшены


@dataclass
class Book:
    sha256: str
    sheets: dict[str, Sheet]


def load(source: str | Path | BinaryIO) -> Book:
    """Читает книгу целиком в память (листы -> списки) и закрывает её: read_only-книга после close() не читается."""
    if isinstance(source, str) and source == "-":
        data = sys.stdin.buffer.read()
    elif isinstance(source, (str, Path)):
        data = Path(source).read_bytes()
    else:
        data = source.read()
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    try:
        sheets = {}
        for ws in wb.worksheets:
            it = ws.iter_rows(values_only=True)
            header = list(next(it, ()))
            rows = [(n, tuple(r)) for n, r in enumerate(it, start=2) if not all(blank(c) for c in r)]
            sheets[ws.title] = Sheet(header, rows)
    finally:
        wb.close()
    return Book(hashlib.sha256(data).hexdigest(), sheets)


# ---------- разбор ----------


@dataclass
class Parsed:
    tz: str = SHEET_TZ
    emails: dict = field(default_factory=dict)  # lower(почта) -> users.id
    errors: list = field(default_factory=list)  # (лист, строка Excel, столбец, причина)
    warnings: list = field(default_factory=list)
    unknown_emails: set = field(default_factory=set)
    read: dict = field(default_factory=dict)  # лист -> прочитано строк
    dups: dict = field(default_factory=lambda: defaultdict(int))
    receipts: list = field(default_factory=list)
    plans: list = field(default_factory=list)
    scans: list = field(default_factory=list)
    boxes: list = field(default_factory=list)
    storage: list = field(default_factory=list)
    archive: list = field(default_factory=list)
    sections: list = field(default_factory=list)
    marks: list = field(default_factory=list)
    counters: dict = field(default_factory=dict)  # категория -> ожидаемое last_number
    pointers: dict = field(default_factory=dict)  # секция -> палет
    raw_scans: list = field(default_factory=list)  # строки листов до удаления дублей — для сверки со Сводкой
    raw_boxes: list = field(default_factory=list)
    raw_storage: list = field(default_factory=list)
    summary: dict = field(default_factory=dict)  # lower(приёмка) -> {метрика: число, started, last}
    tz_checked: tuple = (0, 0)  # (сканов, частей раскладки), прошедших самопроверку

    def err(self, sheet, row, col, reason):
        self.errors.append((sheet, row, col, reason))

    def warn(self, message):
        self.warnings.append(message)


class Row:
    """Строка листа: разбор полей с накоплением ошибок (лист, строка Excel, столбец, причина)."""

    def __init__(self, p: Parsed, sheet: str, number: int, values: tuple, idx: dict, tz: ZoneInfo):
        self.p, self.sheet, self.n, self.values, self.idx, self.tz, self.bad = p, sheet, number, values, idx, tz, False

    def raw(self, col):
        i = self.idx.get(col)
        return self.values[i] if i is not None and i < len(self.values) else None

    def fail(self, col, reason):
        self.bad = True
        self.p.err(self.sheet, self.n, col, reason)

    def get(self, col, conv=text_, *, required=True, default=None):
        v = self.raw(col)
        if blank(v):
            if required:
                self.fail(col, "пусто")
            return default
        try:
            return conv(v)
        except (ValueError, TypeError) as e:
            self.fail(col, str(e))
            return default

    def dt(self, col, *, required=True):
        return self.get(col, lambda v: dt_(v, self.tz), required=required)

    def user(self, col):
        """Почта «Кто» -> users.id. Неизвестная почта — не ошибка строки, а общий список (exit 1)."""
        email = text_(self.raw(col)).lower()
        if not email:
            return None
        uid = self.p.emails.get(email)  # TODO(Q-M1): нет почты в хабе — ошибка, учётки заводит админ заранее
        if uid is None:
            self.p.unknown_emails.add(email)
        return uid


def _open(p: Parsed, book: Book, name: str, required: list, tz: ZoneInfo, ignore=()) -> list[Row]:
    sh = book.sheets.get(name)
    if sh is None:
        p.err(name, 1, "", "нет листа")
        return []
    idx = {}
    for i, h in enumerate(sh.header):
        if isinstance(h, str) and h.strip() and h.strip() not in idx:
            idx[h.strip()] = i
    missing = [c for c in required if c not in idx]
    for c in missing:
        p.err(name, 1, c, "нет обязательного заголовка")
    if missing:
        return []
    cols = [i for h, i in idx.items() if h not in ignore]
    rows = [Row(p, name, n, v, idx, tz) for n, v in sh.rows if not all(blank(v[i]) if i < len(v) else True for i in cols)]
    p.read[name] = len(rows)
    return rows


def _dedupe(p: Parsed, sheet: str, items: list, keyfn, show=str) -> list:
    """Полностью совпадающие строки схлопываются в одну (TODO(Q-M6)); тот же ключ с другим содержимым — ошибка."""
    seen, out, examples = {}, [], []
    for n, d in items:
        k = keyfn(d)
        if k not in seen:
            seen[k] = (n, d)
            out.append(d)
        elif seen[k][1] == d:
            p.dups[sheet] += 1
            examples.append(show(k))
        else:
            p.err(sheet, n, "", f"ключ повторяется (строка {seen[k][0]}) с другим содержимым")
    if examples:
        p.warn(f"{len(examples)} дублей строк «{sheet}» схлопнуто в одну: " + ", ".join(examples[:5]) + (", …" if len(examples) > 5 else ""))
    return out


def parse(book: Book, tz: str, emails: dict) -> Parsed:
    p = Parsed(tz=tz, emails=emails)
    z = ZoneInfo(tz)
    code_max: dict[str, int] = {}

    def track(code):
        cn = code_number(code)
        if cn:
            code_max[cn[0]] = max(code_max.get(cn[0], 0), cn[1])

    # --- Приемки ---
    status_of: dict[str, str] = {}  # lower(имя) -> status
    names: dict[str, str] = {}
    for r in _open(p, book, SH_RECEIPTS, H_RECEIPTS, z):
        name = r.get("Приемка")
        label = r.get("Статус")
        created_at = r.dt("Создана")
        by = r.user("Кто создал")
        if name is not None and not 1 <= len(name) <= 80:
            r.fail("Приемка", "длина названия должна быть 1–80 символов")
        status = RECEIPT_STATUS.get((label or "").lower())
        if label is not None and status is None:
            r.fail("Статус", "неизвестный статус приёмки")
        if name is not None and name.lower() in names:
            r.fail("Приемка", "повтор названия приёмки (без учёта регистра)")
        if r.bad:
            continue
        names[name.lower()] = name
        status_of[name.lower()] = status
        p.receipts.append({"name": name, "status": status, "created_at": created_at, "created_by": by})

    def rk(r: Row):
        v = r.get("Приемка")
        if v is None:
            return None
        if v.lower() not in names:
            r.fail("Приемка", "приёмки нет в листе «Приемки»")
            return None
        return v.lower()

    # --- Раскладки ---
    groups = defaultdict(lambda: defaultdict(list))
    plan_checked, plan_bad = 0, []
    for r in _open(p, book, SH_PLANS, H_PLANS, z):
        key = rk(r)
        version = r.get("Версия", int_)
        part_no = r.get("Часть", int_)
        data = "" if r.raw("Данные") is None else str(r.raw("Данные"))
        file_name = r.get("Файл", required=False, default="")
        who = r.get("Загрузил", required=False, default="")
        when = r.dt("Когда")
        if r.bad:
            continue
        worker, email = (who.rsplit(" / ", 1) if " / " in who else ("", who))
        uid, e = None, email.strip().lower()
        if e:
            uid = emails.get(e)  # TODO(Q-M1): неизвестная почта — ошибка
            if uid is None:
                p.unknown_emails.add(e)
        try:
            diff = (when - _ms_to_dt(version)).total_seconds()
        except (OverflowError, OSError, ValueError):
            diff = None
        plan_checked += 1
        if diff is None or abs(diff) > 2:
            plan_bad.append(diff)
        groups[key][version].append((r.n, part_no, data, {"file_name": file_name, "worker": worker.strip(), "uploaded_by": uid, "uploaded_at": when}))
    for key, versions in groups.items():
        if len(versions) > 1:
            p.warn(f"У приёмки «{names[key]}» несколько версий раскладки ({len(versions)}), берётся максимальная")
        version = max(versions)
        items = sorted(versions[version], key=lambda t: t[1])
        first_row = items[0][0]
        if [t[1] for t in items] != list(range(len(items))):
            p.err(SH_PLANS, first_row, "Часть", "части раскладки должны идти подряд 0..n-1 без пропусков и повторов")
            continue
        data = "".join(t[2] for t in items)
        try:
            json.loads(data)
        except ValueError:
            p.err(SH_PLANS, first_row, "Данные", "склеенные части раскладки — не JSON")
            continue
        if status_of[key] == "finished":
            p.warn(f"Раскладка завершённой приёмки «{names[key]}» не переносится (хаб удаляет её при завершении)")
            continue
        p.plans.append({"rk": key, "version": version, "data": data, **items[0][3]})

    # --- Счётчики ---
    sheet_counters: dict[str, int] = {}
    for r in _open(p, book, SH_COUNTERS, H_COUNTERS, z):
        label = r.get("Счётчик")
        val = r.get("Последний выданный номер", int_)
        if r.bad:
            continue
        m = re.match(r"^(BOX|PAL)_(.+)$", label)
        if not m:
            p.warn(f"Счётчик «{label}» не распознан и не переносится")
        elif m.group(1) == "BOX":
            c = service.part(m.group(2))
            if val < 0 or not re.match(r"^[0-9A-Za-z-]+$", c):
                p.err(SH_COUNTERS, r.n, "Счётчик", "некорректная категория или значение")
            elif sheet_counters.get(c, val) != val:
                p.err(SH_COUNTERS, r.n, "Счётчик", "категория повторяется с другим значением")
            else:
                sheet_counters[c] = val
        else:
            s = service.part(m.group(2))
            if not 1 <= val <= service.PALLETS:
                p.err(SH_COUNTERS, r.n, "Последний выданный номер", "палет должен быть 1–6")
            elif p.pointers.get(s, val) != val:
                p.err(SH_COUNTERS, r.n, "Счётчик", "секция повторяется с другим значением")
            else:
                p.pointers[s] = val

    # --- Сканы ---
    scan_items, ms_checked, ms_bad = [], 0, []
    for r in _open(p, book, SH_SCANS, H_SCANS, z, ignore=("Палет",)):
        sid = r.get("ID")
        label = r.get("Статус")
        box_code = r.get("ШК короба")
        ki = r.get("КИ Честный знак", _ki, required=False)
        d = {
            "id": sid, "scanned_at": r.dt("Время"), "worker": r.get("Сотрудник", required=False, default=""),
            "box_category": r.get("Коробка", lambda v: service.key(text_(v))), "box_code": box_code,
            "barcode": r.get("Баркод", required=False, default=""), "user_id": r.user("Кто"), "rk": rk(r), "ki": ki,
            "full_code": None if blank(r.raw("Код ЧЗ полностью")) else text_(r.raw("Код ЧЗ полностью"), strip=False),
        }
        status = service.STATUS_BY_LABEL.get((label or "").split(", ")[0].strip())
        if label is not None and status is None:
            r.fail("Статус", "неизвестный статус скана")
        if box_code is not None and not (FINAL_BOX_RE.match(box_code) or TEMP_BOX_RE.match(box_code)):
            r.fail("ШК короба", "неверный формат кода короба")
        if r.bad:
            continue
        d["status"], d["no_cz"] = status, label.endswith("без ЧЗ")
        m = SCAN_MS_RE.match(sid)
        if m:
            ms_checked += 1
            if abs((d["scanned_at"] - _ms_to_dt(int(m.group(1)))).total_seconds()) > 5:
                ms_bad.append((d["scanned_at"] - _ms_to_dt(int(m.group(1)))).total_seconds())
        track(box_code)
        scan_items.append((r.n, d))
    p.raw_scans = [d for _, d in scan_items]
    p.scans = _dedupe(p, SH_SCANS, scan_items, lambda d: d["id"])
    temp = Counter(d["box_code"] for d in p.scans if not FINAL_BOX_RE.match(d["box_code"]))
    if temp:  # TODO(Q-M2): сканы незакрытых коробов переносятся как история
        p.warn(
            f"{sum(temp.values())} скана(ов) во временных коробах (незакрытые): "
            + ", ".join(f"{c}×{n}" for c, n in temp.most_common(5)) + (", …" if len(temp) > 5 else "")
        )

    # --- Короба ---
    box_items = []
    for r in _open(p, book, SH_BOXES, H_BOXES, z, ignore=("Палет",)):
        d = {
            "code": r.get("ШК короба", _final_code), "worker": r.get("Сотрудник", required=False, default=""),
            "category": r.get("Коробка", lambda v: service.key(text_(v))), "item_count": r.get("Товаров", _non_negative),
            "opened_at": r.dt("Открыт", required=False), "closed_at": r.dt("Закрыт"), "closed_by": r.user("Кто"), "rk": rk(r),
        }
        if r.bad:
            continue
        track(d["code"])
        box_items.append((r.n, d))
    p.raw_boxes = [d for _, d in box_items]
    p.boxes = _dedupe(p, SH_BOXES, box_items, lambda d: d["code"])

    # --- Хранение и архив ---
    def storage_rows(sheet, headers, extra):
        items = []
        for r in _open(p, book, sheet, headers, z):
            section = r.get("Секция", lambda v: service.part(text_(v)))
            pallet_no = r.get("Палет №", int_)
            d = {
                "pallet_code": r.get("Палет"), "box_code": r.get("ШК короба", _final_code), "section": section, "pallet_no": pallet_no,
                "item_count": r.get("Штук в коробе", _non_negative), "placed_at": r.dt("Поставлен"), "worker": r.get("Сотрудник", required=False, default=""),
                "placed_by": r.user("Кто"), "rk": rk(r), "category": r.get("Категория", lambda v: service.part(text_(v))),
            }
            if extra:
                d["freed_at"] = r.dt("Освобождён")
                d["freed_by"] = r.user("Кто освободил")
            if not r.bad:
                if not 1 <= pallet_no <= service.PALLETS:
                    r.fail("Палет №", "палет должен быть 1–6")
                elif d["pallet_code"] != f"S{section}_P{pallet_no}":
                    r.fail("Палет", "код палета не согласован с секцией и номером палета")
                elif not d["box_code"].startswith(f"S{section}_K{d['category']}_P{pallet_no}_"):
                    r.fail("ШК короба", "код короба не согласован с секцией, категорией и палетом")
            if r.bad:
                continue
            track(d["box_code"])
            items.append((r.n, d))
        return items

    st_items = storage_rows(SH_STORAGE, H_STORAGE, False)
    p.raw_storage = [d for _, d in st_items]
    p.storage = _dedupe(p, SH_STORAGE, st_items, lambda d: d["box_code"])
    per_pallet = Counter(d["pallet_code"] for d in p.storage)
    over = sorted(c for c, n in per_pallet.items() if n > service.cap(int(c.rsplit("_P", 1)[1])))
    if over:
        p.warn(f"Коробов больше вместимости палета: {', '.join(over[:5])}" + (", …" if len(over) > 5 else ""))
    p.archive = _dedupe(p, SH_ARCHIVE, storage_rows(SH_ARCHIVE, H_ARCHIVE, True), lambda d: tuple(sorted((k, str(v)) for k, v in d.items())))

    # --- Секции ---
    sec_items = []
    for r in _open(p, book, SH_SECTIONS, H_SECTIONS, z):
        d = {
            "category": r.get("Категория", lambda v: service.part(text_(v))), "section": r.get("Доп. секция", lambda v: service.part(text_(v))),
            "assigned_at": r.dt("Назначена"), "assigned_by": r.user("Кто"),
        }
        if not r.bad and d["section"] == d["category"]:
            r.fail("Доп. секция", "секция совпадает с категорией")
        if not r.bad:
            sec_items.append((r.n, d))
    p.sections = _dedupe(p, SH_SECTIONS, sec_items, lambda d: d["section"])

    # --- Коды ЧЗ ---
    mark_items = []
    for r in _open(p, book, SH_MARKS, H_MARKS, z):
        ki = r.get("КИ", _ki)
        d = {
            "ki": ki, "gtin": r.get("GTIN", required=False) or (ki[2:16] if ki else None), "registered_at": r.dt("Время"),
            "worker": r.get("Сотрудник", required=False, default=""), "user_id": r.user("Кто"),
            "rk": rk(r),  # TODO(Q-M8): код ЧЗ без приёмки — ошибка (иначе откат по receipt_id его не найдёт)
            "box_category": r.get("Коробка", lambda v: service.key(text_(v)), required=False, default=""),
            "full_code": text_(r.raw("Код полностью"), strip=False), "barcode": r.get("Баркод", required=False, default=""),
        }
        if not r.bad:
            mark_items.append((r.n, d))
    p.marks = _dedupe(p, SH_MARKS, mark_items, lambda d: d["ki"], show=mask_ki)

    # --- Сводка (только для сверки) ---
    for r in _open(p, book, SH_SUMMARY, ["Приемка"] + [m[0] for m in METRICS.values()], z):
        name = r.get("Приемка")
        vals = {k: r.get(h, int_) for k, (h, _) in METRICS.items()}
        if r.bad:
            continue
        vals["started"] = _opt_dt(r.raw("Начало"), z)
        vals["last"] = _opt_dt(r.raw("Последний скан"), z)
        p.summary[name.lower()] = vals

    old = book.sheets.get(SH_PLAN_OLD)
    if old and old.rows:
        p.warn(f"Лист «{SH_PLAN_OLD}» не пуст ({len(old.rows)} строк), он не переносится")

    # --- счётчики: max(лист, номера всех кодов) ---
    for c in set(sheet_counters) | set(code_max):
        p.counters[c] = max(sheet_counters.get(c, 0), code_max.get(c, 0))

    # --- самопроверка часового пояса ---
    p.tz_checked = (ms_checked - len(ms_bad), plan_checked - len(plan_bad))
    bad = ms_bad + [d for d in plan_bad if d is not None]
    if bad or any(d is None for d in plan_bad):
        typical = sorted(round(d / 3600) for d in bad)[len(bad) // 2] if bad else 0
        p.err("tz", 0, "--tz", f"{len(ms_bad)} из {ms_checked} сканов и {len(plan_bad)} из {plan_checked} частей раскладки не сходятся "
              f"с эпохой в ID/версии при tz={tz}; типичное смещение {typical:+d} ч — проверьте --tz")
    elif ms_checked + plan_checked == 0:
        p.warn("Часовой пояс проверить нечем (нет сканов с ID вида W-<мс> и раскладок)")
    return p


def _ki(v) -> str:
    s = text_(v)
    if not service.KI_RE.match(s):
        raise ValueError("неверный КИ")
    return s


def _final_code(v) -> str:
    s = text_(v)
    if not FINAL_BOX_RE.match(s):
        raise ValueError("неверный формат итогового кода короба")
    return s


def _non_negative(v) -> int:
    n = int_(v)
    if n < 0:
        raise ValueError("число не может быть отрицательным")
    return n


def _opt_dt(v, z: ZoneInfo):
    try:
        return dt_(v, z)
    except ValueError:
        return None


# ---------- сверка ----------


def metrics(rks, scans, boxes, storage) -> dict:
    """Те же метрики, что у warehouse_receipt_summary / листа «Сводка»."""
    m = {k: dict.fromkeys(METRICS, 0) for k in rks}
    stored = {s["box_code"] for s in storage}
    pallets = defaultdict(set)
    for s in storage:
        pallets[s["rk"]].add(s["pallet_code"])
    for s in scans:
        x = m[s["rk"]]
        x["scanned"] += 1
        x["not_in_file"] += s["status"] in ("unknown", "foreign")
        x["surplus"] += s["status"] == "extra"
        x["cz_codes"] += s["ki"] is not None
        x["marked_without_cz"] += bool(s["no_cz"])
    for b in boxes:
        m[b["rk"]]["boxes_closed"] += 1
        m[b["rk"]]["boxes_without_pallet"] += b["code"] not in stored
    for k in rks:
        m[k]["pallets"] = len(pallets[k])
    return m


def _view_metrics(session: Session) -> dict:
    cols = ", ".join(METRICS)
    rows = session.execute(text(f"SELECT receipt, started_at, last_scan_at, {cols} FROM trendsetter_hub.warehouse_receipt_summary")).mappings().all()
    return {r["receipt"].lower(): {**{k: int(r[k]) for k in METRICS}, "started": r["started_at"], "last": r["last_scan_at"]} for r in rows}


def _fmt(dt, z: ZoneInfo) -> str:
    return dt.astimezone(z).strftime("%d.%m.%Y %H:%M") if dt else "—"


def reconcile(session: Session, p: Parsed, names: dict) -> tuple[list[str], bool]:
    """(a) Сводка против сырых строк файла; (b) представление БД против файла без дублей; (c) счётчики против кодов всей БД."""
    z = ZoneInfo(p.tz)
    rks = sorted(names)
    raw = metrics(rks, p.raw_scans, p.raw_boxes, p.raw_storage)
    clean = metrics(rks, p.scans, p.boxes, p.storage)
    hub = _view_metrics(session)
    ok_all = True
    lines = ["Сверка со Сводкой:  приёмка | метрика | Сводка | в файле | дублей | в хабе | OK"]
    for k in rks:
        summ = p.summary.get(k)
        for key, (_, label) in METRICS.items():
            s_val = summ[key] if summ else None
            dup = raw[k][key] - clean[k][key]
            h_val = hub.get(k, {}).get(key)
            ok_a, ok_b = s_val == raw[k][key], h_val == clean[k][key]
            ok_all &= ok_a and ok_b
            flag = "OK" if ok_a and ok_b else ("РАСХОЖДЕНИЕ со Сводкой" if not ok_a else "РАСХОЖДЕНИЕ с хабом")
            lines.append(f"  {names[k]} | {label} | {'нет строки' if s_val is None else s_val} | {raw[k][key]} | {dup} | {h_val} | {flag}")
        h = hub.get(k, {})
        lines.append(
            f"  {names[k]} | начало / последний скан — Сводка: {_fmt(summ and summ['started'], z)} / {_fmt(summ and summ['last'], z)}; "
            f"хаб: {_fmt(h.get('started'), z)} / {_fmt(h.get('last'), z)} (только для глаз)"
        )
    top: dict[str, int] = {}
    codes = session.execute(
        text(
            f"""SELECT box_code FROM {S}scans UNION SELECT code FROM {S}boxes
                UNION SELECT box_code FROM {S}storage_boxes UNION SELECT box_code FROM {S}storage_archive"""
        )
    ).scalars()
    for c in codes:
        cn = code_number(c)
        if cn:
            top[cn[0]] = max(top.get(cn[0], 0), cn[1])
    counters = dict(session.execute(text(f"SELECT category, last_number FROM {S}box_counters")).all())
    low = sorted(c for c, n in top.items() if counters.get(c, -1) < n)
    ok_c = not low
    lines.append("  Счётчики коробов ≥ максимальных номеров в кодах всей БД: " + ("OK" if ok_c else "РАСХОЖДЕНИЕ, категории: " + ", ".join(low)))
    return lines, ok_all and ok_c


# ---------- проверки БД и вставки ----------


def _foreign(session, sql: str, params: dict, show=str) -> tuple[int, list[str]]:
    row = session.execute(text(sql), params).one()
    return row.n, [show(x) for x in (row.s or [])]


def conflicts(session: Session, p: Parsed, existing: dict) -> list[tuple[str, int, list[str]]]:
    """«В БД только данные этого файла»: чужие строки в любой из 10 таблиц. existing: lower(имя) -> (id, имя) приёмок БД."""
    out = []

    def add(label, res):
        if res[0]:
            out.append((label, res[0], res[1]))

    file_names = {r["name"].lower() for r in p.receipts}
    foreign = sorted(name for k, (_, name) in existing.items() if k not in file_names)
    if foreign:
        out.append(("receipts", len(foreign), foreign[:5]))
    add("scans", _foreign(session, f"SELECT count(*) AS n, (array_agg(id))[1:5] AS s FROM {S}scans WHERE NOT (id = ANY(CAST(:k AS text[])))", {"k": [d["id"] for d in p.scans]}))
    add("boxes", _foreign(session, f"SELECT count(*) AS n, (array_agg(code))[1:5] AS s FROM {S}boxes WHERE NOT (code = ANY(CAST(:k AS text[])))", {"k": [d["code"] for d in p.boxes]}))
    add("storage_boxes", _foreign(session, f"SELECT count(*) AS n, (array_agg(box_code))[1:5] AS s FROM {S}storage_boxes WHERE NOT (box_code = ANY(CAST(:k AS text[])))", {"k": [d["box_code"] for d in p.storage]}))
    add(
        "storage_archive",
        _foreign(
            session,
            f"""SELECT count(*) AS n, (array_agg(a.box_code))[1:5] AS s FROM {S}storage_archive a
                WHERE NOT EXISTS (SELECT 1 FROM unnest(CAST(:b AS text[]), CAST(:p AS text[]), CAST(:f AS timestamptz[])) AS x(b, p, f)
                                  WHERE x.b = a.box_code AND x.p = a.pallet_code AND x.f = a.freed_at)""",
            {"b": [d["box_code"] for d in p.archive], "p": [d["pallet_code"] for d in p.archive], "f": [d["freed_at"] for d in p.archive]},
        ),
    )
    add("marks", _foreign(session, f"SELECT count(*) AS n, (array_agg(ki))[1:5] AS s FROM {S}marks WHERE NOT (ki = ANY(CAST(:k AS text[])))", {"k": [d["ki"] for d in p.marks]}, mask_ki))
    add("extra_sections", _foreign(session, f"SELECT count(*) AS n, (array_agg(section))[1:5] AS s FROM {S}extra_sections WHERE NOT (section = ANY(CAST(:k AS text[])))", {"k": [d["section"] for d in p.sections]}))
    add(
        "receipt_plans",
        _foreign(
            session,
            f"""SELECT count(*) AS n, (array_agg(p.receipt_id::text))[1:5] AS s FROM {S}receipt_plans p
                WHERE NOT EXISTS (SELECT 1 FROM unnest(CAST(:i AS bigint[]), CAST(:v AS bigint[])) AS x(i, v) WHERE x.i = p.receipt_id AND x.v = p.version)""",
            {"i": [existing[d["rk"]][0] for d in p.plans if d["rk"] in existing], "v": [d["version"] for d in p.plans if d["rk"] in existing]},
        ),
    )
    add(
        "box_counters",
        _foreign(
            session,
            f"""SELECT count(*) AS n, (array_agg(c.category))[1:5] AS s FROM {S}box_counters c
                WHERE NOT EXISTS (SELECT 1 FROM unnest(CAST(:c AS text[]), CAST(:n AS integer[])) AS x(c, n) WHERE x.c = c.category AND c.last_number <= x.n)""",
            {"c": list(p.counters), "n": list(p.counters.values())},
        ),
    )
    add(
        "pallet_pointers",
        _foreign(
            session,
            f"""SELECT count(*) AS n, (array_agg(c.section))[1:5] AS s FROM {S}pallet_pointers c
                WHERE NOT EXISTS (SELECT 1 FROM unnest(CAST(:s AS text[]), CAST(:p AS integer[])) AS x(s, p) WHERE x.s = c.section AND c.current_pallet = x.p)""",
            {"s": list(p.pointers), "p": list(p.pointers.values())},
        ),
    )
    return out


def _run(session: Session, sql: str, rows: list) -> None:
    for i in range(0, len(rows), BATCH):
        session.execute(text(sql), rows[i : i + BATCH])


def table_counts(session: Session) -> dict:
    sql = " UNION ALL ".join(f"SELECT '{t}' AS tbl, count(*) AS n FROM {S}{t}" for t in ALL_TABLES)
    return {r.tbl: r.n for r in session.execute(text(sql))}


def insert_all(session: Session, p: Parsed) -> dict:
    _run(
        session,
        f"INSERT INTO {S}receipts (name, status, created_at, created_by) VALUES (:name, :status, :created_at, :created_by) ON CONFLICT DO NOTHING",
        p.receipts,
    )
    rid = {name.lower(): i for i, name in session.execute(text(f"SELECT id, name FROM {S}receipts")).all()}
    _run(
        session,
        f"""INSERT INTO {S}receipt_plans (receipt_id, version, file_name, data, uploaded_by, worker, uploaded_at)
            VALUES (:r, :version, :file_name, CAST(:data AS jsonb), :uploaded_by, :worker, :uploaded_at) ON CONFLICT (receipt_id) DO NOTHING""",
        [{**d, "r": rid[d["rk"]]} for d in p.plans],
    )
    _run(
        session,
        f"""INSERT INTO {S}scans (id, scanned_at, worker, user_id, receipt_id, box_category, box_code, barcode, status, no_cz, ki, full_code)
            VALUES (:id, :scanned_at, :worker, :user_id, :r, :box_category, :box_code, :barcode, :status, :no_cz, :ki, :full_code) ON CONFLICT (id) DO NOTHING""",
        [{**d, "r": rid[d["rk"]]} for d in p.scans],
    )
    _run(
        session,
        f"""INSERT INTO {S}boxes (code, category, item_count, worker, opened_at, closed_at, closed_by, receipt_id)
            VALUES (:code, :category, :item_count, :worker, :opened_at, :closed_at, :closed_by, :r) ON CONFLICT (code) DO NOTHING""",
        [{**d, "r": rid[d["rk"]]} for d in p.boxes],
    )
    cols = "box_code, pallet_code, section, pallet_no, item_count, placed_at, worker, placed_by, receipt_id, category"
    _run(
        session,
        f"""INSERT INTO {S}storage_boxes ({cols}) VALUES (:box_code, :pallet_code, :section, :pallet_no, :item_count, :placed_at, :worker, :placed_by, :r, :category)
            ON CONFLICT (box_code) DO NOTHING""",
        [{**d, "r": rid[d["rk"]]} for d in p.storage],
    )
    _run(
        session,
        f"""INSERT INTO {S}storage_archive ({cols}, freed_at, freed_by)
            SELECT CAST(:box_code AS text), CAST(:pallet_code AS text), CAST(:section AS text), CAST(:pallet_no AS smallint), CAST(:item_count AS integer),
                   CAST(:placed_at AS timestamptz), CAST(:worker AS text), CAST(:placed_by AS bigint), CAST(:r AS bigint), CAST(:category AS text),
                   CAST(:freed_at AS timestamptz), CAST(:freed_by AS bigint)
            WHERE NOT EXISTS (SELECT 1 FROM {S}storage_archive a WHERE a.box_code = :box_code AND a.pallet_code = :pallet_code AND a.freed_at = :freed_at)""",
        [{**d, "r": rid[d["rk"]]} for d in p.archive],
    )
    _run(
        session,
        f"INSERT INTO {S}extra_sections (section, category, assigned_at, assigned_by) VALUES (:section, :category, :assigned_at, :assigned_by) ON CONFLICT (section) DO NOTHING",
        p.sections,
    )
    _run(
        session,
        f"""INSERT INTO {S}marks (ki, gtin, registered_at, worker, user_id, receipt_id, box_category, full_code, barcode)
            VALUES (:ki, :gtin, :registered_at, :worker, :user_id, :r, :box_category, :full_code, :barcode) ON CONFLICT (ki) DO NOTHING""",
        [{**d, "r": rid[d["rk"]]} for d in p.marks],
    )
    _run(
        session,
        f"""INSERT INTO {S}box_counters (category, last_number) VALUES (:c, :n)
            ON CONFLICT (category) DO UPDATE SET last_number = GREATEST({S}box_counters.last_number, :n)""",
        [{"c": c, "n": n} for c, n in p.counters.items()],
    )
    _run(session, f"INSERT INTO {S}pallet_pointers (section, current_pallet) VALUES (:s, :p) ON CONFLICT DO NOTHING", [{"s": s, "p": n} for s, n in p.pointers.items()])
    return rid


def snapshot(session: Session) -> dict:
    """Состояние всех таблиц Склада (число строк по приёмкам, счётчики, указатели, секции) — для записи в журнал и проверки отката.
    Только числа и служебные ключи: ни КИ, ни почт."""
    rows = {
        t: {k: n for k, n in session.execute(text(f"SELECT COALESCE(receipt_id::text, '-'), count(*) FROM {S}{t} GROUP BY 1"))} for t in RECEIPT_TABLES
    }
    snap = {
        "rows": rows,
        "receipts": {str(i): [name, status] for i, name, status in session.execute(text(f"SELECT id, name, status FROM {S}receipts"))},
        "counters": dict(session.execute(text(f"SELECT category, last_number FROM {S}box_counters")).all()),
        "pointers": dict(session.execute(text(f"SELECT section, current_pallet FROM {S}pallet_pointers")).all()),
        "sections": sorted([s, c] for s, c in session.execute(text(f"SELECT section, category FROM {S}extra_sections"))),
    }
    return json.loads(json.dumps(snap))  # ключи и значения как после JSONB


def diff_state(old, new, path="") -> list[str]:
    if isinstance(old, dict) and isinstance(new, dict):
        out = []
        for k in sorted(set(old) | set(new)):
            out += diff_state(old.get(k), new.get(k), f"{path}{k}.")
        return out
    return [] if old == new else [f"{path.rstrip('.')}: было {old!r}, стало {new!r}"]


# ---------- отчёт и команды ----------


@dataclass
class Report:
    exit_code: int
    lines: list

    def text(self) -> str:
        return "\n".join(self.lines)


def _db_error(header: str, e: DBAPIError) -> Report:
    """Сообщения psycopg содержат значения строк (КИ) — печатаем только таблицу и ограничение."""
    diag = getattr(getattr(e, "orig", None), "diag", None)
    table, constraint = getattr(diag, "table_name", None), getattr(diag, "constraint_name", None)
    return Report(1, [header, f"Ошибка БД ({type(getattr(e, 'orig', e)).__name__}): таблица={table}, ограничение={constraint}. Ничего не записано."])


def _lock(session: Session) -> None:
    session.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": service.LOCK_STORAGE})


def import_workbook(session: Session, source, *, apply: bool, tz: str = SHEET_TZ) -> Report:
    mode = "ЗАПИСЬ" if apply else "СУХОЙ ПРОГОН (ничего не записано)"
    head = f"Перенос «Склад-приемка»: {mode}"
    try:
        return _import(session, source, apply, tz, head)
    except DBAPIError as e:
        session.rollback()
        return _db_error(head, e)
    except BaseException:
        session.rollback()
        raise


def _import(session: Session, source, apply: bool, tz: str, head: str) -> Report:
    try:
        ZoneInfo(tz)
    except Exception:  # noqa: BLE001 — любое значение --tz, которое не разобрать
        return Report(1, [head, f"Неизвестный часовой пояс: {tz}"])
    _lock(session)
    emails = {e: i for i, e in session.execute(text("SELECT id, lower(email) FROM trendsetter_hub.users")).all()}
    try:
        book = load(source)
    except Exception as e:  # noqa: BLE001 — не xlsx / повреждён; текст исключения не печатаем
        session.rollback()
        return Report(1, [head, f"Не удалось прочитать xlsx ({type(e).__name__})"])
    p = parse(book, tz, emails)
    head += f"    файл sha256={book.sha256[:12]}…   tz={tz} (проверено: {p.tz_checked[0]} скана, {p.tz_checked[1]} частей раскладки)"
    names = {r["name"].lower(): r["name"] for r in p.receipts}
    if p.errors or p.unknown_emails:
        lines = [head, f"Ошибок в файле: {len(p.errors)}" + (" (показаны первые 50)" if len(p.errors) > 50 else "")]
        lines += [f"  {s} | строка {n} | {c} | {why}" for s, n, c, why in p.errors[:50]]
        if p.unknown_emails:
            lines.append(f"Нет такого пользователя в хабе ({len(p.unknown_emails)}) — завести в админке и запустить повторно:")
            lines += [f"  {e}" for e in sorted(p.unknown_emails)]
        session.rollback()
        return Report(1, lines + ["Итог: 1 — ошибки файла, ничего не записано"])

    existing = {name.lower(): (i, name) for i, name in session.execute(text(f"SELECT id, name FROM {S}receipts")).all()}
    found = conflicts(session, p, existing)
    if found:
        lines = [head, "В БД есть данные, которых нет в файле (перенос рассчитан на БД без чужих данных склада):"]
        lines += [f"  {t}: чужих строк {n}, примеры: {', '.join(ex) or '—'}" for t, n, ex in found]
        session.rollback()
        return Report(2, lines + ["Итог: 2 — конфликт с данными БД, ничего не записано (тестовые данные чистит владелец БД: db/modules/warehouse/cleanup_test_data.sql)"])

    before = table_counts(session)
    rid = insert_all(session, p)
    after = table_counts(session)
    inserted = {t: after[t] - before[t] for t in ALL_TABLES}

    wanted = {
        "receipts": (SH_RECEIPTS, len(p.receipts)), "receipt_plans": (SH_PLANS, len(p.plans)), "scans": (SH_SCANS, len(p.scans)),
        "boxes": (SH_BOXES, len(p.boxes)), "storage_boxes": (SH_STORAGE, len(p.storage)), "storage_archive": (SH_ARCHIVE, len(p.archive)),
        "extra_sections": (SH_SECTIONS, len(p.sections)), "marks": (SH_MARKS, len(p.marks)),
        "box_counters": (SH_COUNTERS, len(p.counters)), "pallet_pointers": (SH_COUNTERS, len(p.pointers)),
    }
    verb = "вставлено" if apply else "вставится"
    lines = [head, f"{'таблица':<17}{'прочитано':>10}{'дублей':>8}{verb:>11}{'уже есть':>10}"]
    for t in ALL_TABLES:
        sheet, n = wanted[t]
        lines.append(f"{t:<17}{p.read.get(sheet, 0):>10}{p.dups.get(sheet, 0):>8}{inserted[t]:>11}{max(n - inserted[t], 0):>10}")
    if p.warnings:
        lines.append("Предупреждения:")
        lines += [f"  {w}" for w in p.warnings]

    rec_lines, ok = reconcile(session, p, names)
    lines += rec_lines
    if not ok:
        session.rollback()
        return Report(3, lines + ["Итог: 3 — сверка не сошлась, ничего не записано (выгрузка не согласована — нужна новая)"])

    total = sum(inserted.values())
    if apply and total:
        # TODO(Q-M7): метка источника без DDL — запись в журнал; по ней работает откат (до начала живой работы)
        log_action(
            session, None, ACTION, service.MODULE_ID, file_sha256=book.sha256,
            receipts=[{"id": rid[k], "name": n} for k, n in sorted(names.items())], state=snapshot(session),
        )
        session.commit()
        lines.append("Итог: 0 — перенос записан")
        return Report(0, lines)
    session.rollback()
    if apply:
        lines.append("Уже перенесено, изменений нет")
        lines.append("Итог: 0")
    else:
        lines.append("Итог: 0 — можно запускать с --apply")
    return Report(0, lines)


def rollback_import(session: Session, *, apply: bool) -> Report:
    mode = "ОТКАТ (удаление перенесённых данных)" if apply else "ОТКАТ — СУХОЙ ПРОГОН (ничего не удалено)"
    head = f"Откат переноса «Склад-приемка»: {mode}"
    try:
        return _rollback(session, apply, head)
    except DBAPIError as e:
        session.rollback()
        return _db_error(head, e)
    except BaseException:
        session.rollback()
        raise


def _rollback(session: Session, apply: bool, head: str) -> Report:
    _lock(session)
    # TODO(Q-M7): откат читает последнюю запись warehouse.legacy_import, на которую ещё нет записи об откате
    row = session.execute(
        text(
            """SELECT a.id, a.details FROM trendsetter_hub.audit_log a
               WHERE a.action = :a AND NOT EXISTS (SELECT 1 FROM trendsetter_hub.audit_log r WHERE r.action = :r AND r.details->>'import_audit_id' = a.id::text)
               ORDER BY a.id DESC LIMIT 1"""
        ),
        {"a": ACTION, "r": ACTION_ROLLBACK},
    ).first()
    if row is None:
        session.rollback()
        return Report(2, [head, "Нет переноса, который можно откатить", "Итог: 2"])
    state = row.details["state"]
    diff = diff_state(state, snapshot(session))
    if diff:
        session.rollback()
        return Report(
            2,
            [head, "Началась живая работа — автоматический откат невозможен. Отличия от состояния после переноса:"]
            + [f"  {d}" for d in diff[:30]] + ["Итог: 2"],
        )
    ids = [int(i) for i in state["receipts"]]
    counts = {}
    for t in ("marks", "storage_archive", "storage_boxes", "boxes", "scans", "receipt_plans"):
        counts[t] = session.execute(text(f"DELETE FROM {S}{t} WHERE receipt_id = ANY(:i)"), {"i": ids}).rowcount
    counts["extra_sections"] = session.execute(text(f"DELETE FROM {S}extra_sections WHERE section = ANY(:k)"), {"k": [s for s, _ in state["sections"]]}).rowcount
    counts["pallet_pointers"] = session.execute(text(f"DELETE FROM {S}pallet_pointers WHERE section = ANY(:k)"), {"k": list(state["pointers"])}).rowcount
    counts["box_counters"] = session.execute(text(f"DELETE FROM {S}box_counters WHERE category = ANY(:k)"), {"k": list(state["counters"])}).rowcount
    counts["receipts"] = session.execute(text(f"DELETE FROM {S}receipts WHERE id = ANY(:i)"), {"i": ids}).rowcount
    lines = [head] + [f"  {t}: {'удалено' if apply else 'будет удалено'} {n}" for t, n in counts.items()]
    if apply:
        log_action(session, None, ACTION_ROLLBACK, service.MODULE_ID, import_audit_id=str(row.id), counts=counts)
        session.commit()
    else:
        session.rollback()
        lines.append("Итог: 0 — можно запускать с --apply")
        return Report(0, lines)
    return Report(0, lines + ["Итог: 0 — откат выполнен"])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.modules.warehouse.legacy_import", description="Разовый перенос Склада из xlsx старой системы")
    ap.add_argument("file", nargs="?", help="путь к xlsx или «-» (stdin)")
    ap.add_argument("--apply", action="store_true", help="записать (по умолчанию сухой прогон)")
    ap.add_argument("--tz", default=SHEET_TZ, help=f"часовой пояс листов (по умолчанию {SHEET_TZ})")
    ap.add_argument("--rollback", action="store_true", help="откатить последний перенос (файл не нужен)")
    args = ap.parse_args(argv)
    if args.rollback == bool(args.file):
        print("Нужно одно из двух: FILE|- (перенос) или --rollback (откат)", file=sys.stderr)
        return 1
    try:
        with Session(get_engine()) as session:
            report = rollback_import(session, apply=args.apply) if args.rollback else import_workbook(session, args.file, apply=args.apply, tz=args.tz)
    except Exception as e:  # noqa: BLE001 — текст исключения может содержать значения строк (КИ), печатаем только тип
        print(f"Непредвиденная ошибка: {type(e).__name__}", file=sys.stderr)
        return 1
    print(report.text())
    return report.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
