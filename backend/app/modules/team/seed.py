"""Разовая загрузка людей в «Карту команды» из team.json (макет design/…/data/team.json). Файл в репозиторий не копируется.

Запуск (разовая команда, к HTTP не подключается; в контейнере API, под пользователем hub_app):

  python -m app.modules.team.seed FILE|-            # сухой прогон (по умолчанию, ничего не пишет)
  python -m app.modules.team.seed FILE|- --apply    # запись
  python -m app.modules.team.seed --rollback        # откат последней загрузки, сухой прогон
  python -m app.modules.team.seed --rollback --apply

"-" — файл читается из stdin (docker exec -i ... < team.json). Вся загрузка — одна транзакция, сухой прогон делает ROLLBACK.
Коды выхода: 0 — успех / чистый сухой прогон; 1 — ошибки файла или БД; 2 — в БД уже есть карточки (загрузка) или откат невозможен.
Персональные данные (имена, почты, telegram) не печатаются и не пишутся в журнал: только счётчики и id из файла.
"""
import argparse
import hashlib
import json
import sys
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.core.audit import log_action
from app.db.database import get_engine
from app.modules.team import service

ACTION = "team.seed_import"
ACTION_ROLLBACK = "team.seed_rollback"
LOCK_TEAM = 90012
S = service.S
LEADERSHIP = "leadership"
ANSWER_KEYS = {"location": "location", "workFormat": "work_format", "responsibility": "responsibility", "askMeAbout": "ask_me_about"}


@dataclass
class Report:
    exit_code: int
    lines: list

    def text(self) -> str:
        return "\n".join(self.lines)


def _ids(items, limit: int = 5) -> str:
    items = sorted(items)
    return ", ".join(items[:limit]) + (", …" if len(items) > limit else "")


def _s(v) -> str | None:
    return v.strip() or None if isinstance(v, str) else None


def parse(data, db_directions: set[str]) -> tuple[list[dict], list[str], dict]:
    """Файл -> (карточки в порядке файла, ошибки, статистика). В ошибки попадают только id из файла."""
    errors: list[str] = []
    stats = {"direction_mismatch": [], "direction_fallback": [], "no_first_name": [], "dup_email": []}
    raw = data.get("people") if isinstance(data, dict) else None
    if not isinstance(raw, list) or not raw:
        return [], ["нет списка people"], stats
    ceo = data.get("ceoId")
    assistants = set(data.get("assistantIds") or [])
    by_id: dict = {}
    for i, p in enumerate(raw):
        pid = p.get("id") if isinstance(p, dict) else None
        if not isinstance(pid, str) or not pid or pid in by_id:
            errors.append(f"people[{i}]: пустой или повторяющийся id")
            continue
        by_id[pid] = p
    if errors:
        return [], errors, stats
    if ceo not in by_id:
        errors.append("ceoId не найден среди people")
    dir_by_root = {r: d.get("id") for d in data.get("directions") or [] for r in d.get("rootIds") or []}

    def root_of(pid):
        """Предок, чей руководитель — CEO; None, если цепочка не доходит до CEO (обрыв или цикл)."""
        seen, cur = set(), pid
        while True:
            mgr = by_id[cur].get("managerId")
            if mgr == ceo:
                return cur
            if mgr is None or mgr not in by_id or mgr in seen or mgr == cur:
                return None
            seen.add(cur)
            cur = mgr

    people, emails = [], {}
    for pid, p in by_id.items():
        mgr = p.get("managerId")
        if pid == ceo:
            if mgr is not None:
                errors.append(f"{pid}: у CEO есть руководитель")
        elif mgr is None or mgr not in by_id:
            errors.append(f"{pid}: руководитель не найден")
    if errors:
        return [], errors, stats
    for sort, (pid, p) in enumerate(by_id.items()):
        name, title = _s(p.get("name")), _s(p.get("title"))
        if not name or not title:
            errors.append(f"{pid}: пустое имя или должность")
            continue
        last, _, first = name.partition(" ")  # «Фамилия Имя»
        if not first.strip():
            stats["no_first_name"].append(pid)
        if pid == ceo or pid in assistants:
            direction = LEADERSHIP
        else:
            root = root_of(pid)
            if root is None:
                errors.append(f"{pid}: цепочка руководителей не доходит до CEO")
                continue
            direction = dir_by_root.get(root)
            if direction is None:
                direction = p.get("directionId")
                stats["direction_fallback"].append(pid)
        if direction not in db_directions:
            errors.append(f"{pid}: направление не найдено в справочнике")
            continue
        if p.get("directionId") != direction:
            stats["direction_mismatch"].append(pid)
        answers = {col: _s(p.get(key)) for key, col in ANSWER_KEYS.items() if _s(p.get(key))}
        hobbies = [h.strip() for h in p.get("hobbies") or [] if isinstance(h, str) and h.strip()]
        if hobbies:
            answers["hobbies"] = hobbies
        telegram = (_s(p.get("telegram")) or "").lstrip("@").strip()
        if telegram:
            answers["telegram"] = telegram
        email = _s(p.get("email"))
        if email:
            if email.lower() in emails:
                stats["dup_email"].append(pid)
            emails[email.lower()] = pid
        people.append(
            {
                "key": pid, "manager_key": p.get("managerId"), "email": email, "first_name": first.strip(), "last_name": last, "title": title,
                "direction_id": direction, "tag": _s(p.get("tag")), "team": _s(p.get("team")), "is_ceo": pid == ceo, "is_assistant": pid in assistants,
                "answers": answers, "sort": sort,
            }
        )
    if stats["dup_email"]:
        errors.append(f"повторяются почты (без учёта регистра) у {len(stats['dup_email'])} карточек: {_ids(stats['dup_email'])}")
    return people, errors, stats


def _lock(session: Session) -> None:
    session.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": LOCK_TEAM})


def _db_error(header: str, e: DBAPIError) -> Report:
    """Сообщения psycopg содержат значения строк (ПДн) — печатаем только таблицу и ограничение."""
    diag = getattr(getattr(e, "orig", None), "diag", None)
    return Report(1, [header, f"Ошибка БД ({type(getattr(e, 'orig', e)).__name__}): таблица={getattr(diag, 'table_name', None)}, "
                              f"ограничение={getattr(diag, 'constraint_name', None)}. Ничего не записано."])


def seed_people(session: Session, source, *, apply: bool) -> Report:
    head = f"Загрузка «Карты команды»: {'ЗАПИСЬ' if apply else 'СУХОЙ ПРОГОН (ничего не записано)'}"
    try:
        return _seed(session, source, apply, head)
    except DBAPIError as e:
        session.rollback()
        return _db_error(head, e)
    except BaseException:
        session.rollback()
        raise


def _read(source) -> bytes:
    if isinstance(source, str) and source == "-":
        return sys.stdin.buffer.read()
    if isinstance(source, (str, Path)):
        return Path(source).read_bytes()
    return source.read()


def _seed(session: Session, source, apply: bool, head: str) -> Report:
    _lock(session)
    try:
        blob = _read(source)
        data = json.loads(blob.decode("utf-8-sig"))
    except Exception as e:  # noqa: BLE001 — текст исключения не печатаем (может содержать фрагменты файла)
        session.rollback()
        return Report(1, [head, f"Не удалось прочитать JSON ({type(e).__name__})"])
    sha = hashlib.sha256(blob).hexdigest()
    head += f"    файл sha256={sha[:12]}…"
    db_directions = set(session.execute(text(f"SELECT id FROM {S}directions")).scalars())
    people, errors, stats = parse(data, db_directions)
    if errors:
        session.rollback()
        return Report(1, [head, f"Ошибок в файле: {len(errors)}", *[f"  {e}" for e in errors[:50]], "Итог: 1 — ошибки файла, ничего не записано"])
    existing = session.execute(text(f"SELECT count(*) FROM {S}people")).scalar_one()
    if existing:
        session.rollback()
        return Report(2, [head, f"В team_people уже есть карточки ({existing}) — загрузка рассчитана на пустую таблицу", "Итог: 2 — ничего не записано"])

    ids = {}
    for p in people:
        ids[p["key"]] = session.execute(
            text(
                f"""INSERT INTO {S}people (email, first_name, last_name, title, direction_id, tag, team, is_ceo, is_assistant, answers, sort)
                    VALUES (:email, :first_name, :last_name, :title, :direction_id, :tag, :team, :is_ceo, :is_assistant, CAST(:answers AS jsonb), :sort)
                    RETURNING id"""
            ),
            {**{k: v for k, v in p.items() if k not in ("key", "manager_key", "answers")}, "answers": json.dumps(p["answers"], ensure_ascii=False)},
        ).scalar_one()
    for p in people:  # руководители — вторым проходом, когда все id известны
        if p["manager_key"] is not None:
            session.execute(text(f"UPDATE {S}people SET manager_id = :m WHERE id = :i"), {"m": ids[p["manager_key"]], "i": ids[p["key"]]})

    lines = [head, f"Карточек: {len(people)}, с руководителем: {sum(p['manager_key'] is not None for p in people)}",
             f"CEO: {sum(p['is_ceo'] for p in people)}, ассистентов: {sum(p['is_assistant'] for p in people)}",
             f"С почтой: {sum(bool(p['email']) for p in people)}, с telegram: {sum('telegram' in p['answers'] for p in people)}"]
    if stats["no_first_name"]:
        lines.append(f"Предупреждение: имя без фамилии/имени (first_name пуст) у {len(stats['no_first_name'])}: {_ids(stats['no_first_name'])}")
    if stats["direction_mismatch"]:
        lines.append(f"Предупреждение: направление по корню дерева отличается от directionId файла у {len(stats['direction_mismatch'])}: {_ids(stats['direction_mismatch'])}")
    if stats["direction_fallback"]:
        lines.append(f"Предупреждение: корня нет в rootIds, взят directionId файла у {len(stats['direction_fallback'])}: {_ids(stats['direction_fallback'])}")
    if apply:
        log_action(session, None, ACTION, service.MODULE_ID, file_sha256=sha, person_ids=sorted(ids.values()), count=len(ids))
        session.commit()
        return Report(0, lines + ["Итог: 0 — загрузка записана"])
    session.rollback()
    return Report(0, lines + ["Итог: 0 — можно запускать с --apply"])


def rollback_seed(session: Session, *, apply: bool) -> Report:
    head = f"Откат загрузки «Карты команды»: {'УДАЛЕНИЕ' if apply else 'СУХОЙ ПРОГОН (ничего не удалено)'}"
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
    row = session.execute(
        text(
            """SELECT a.id, a.details FROM trendsetter_hub.audit_log a
               WHERE a.action = :a AND NOT EXISTS (SELECT 1 FROM trendsetter_hub.audit_log r WHERE r.action = :r AND r.details->>'seed_audit_id' = a.id::text)
               ORDER BY a.id DESC LIMIT 1"""
        ),
        {"a": ACTION, "r": ACTION_ROLLBACK},
    ).first()
    if row is None:
        session.rollback()
        return Report(2, [head, "Нет загрузки, которую можно откатить", "Итог: 2"])
    ids = [int(i) for i in row.details["person_ids"]]
    q = lambda sql: session.execute(text(sql), {"i": ids}).scalar_one()  # noqa: E731
    live = {
        "привязано к учётным записям": q(f"SELECT count(*) FROM {S}people WHERE id = ANY(:i) AND user_id IS NOT NULL"),
        "изменено после загрузки": q(f"SELECT count(*) FROM {S}people WHERE id = ANY(:i) AND updated_at > created_at"),
        "с фото": q(f"SELECT count(*) FROM {S}photos WHERE person_id = ANY(:i)"),
        "заявок на эти карточки": q(f"SELECT count(*) FROM {S}submissions WHERE person_id = ANY(:i)"),
        "добавленных позже подчинённых": q(f"SELECT count(*) FROM {S}people WHERE manager_id = ANY(:i) AND NOT (id = ANY(:i))"),
    }
    found = {k: n for k, n in live.items() if n}
    if found:
        session.rollback()
        return Report(2, [head, "Началась живая работа — автоматический откат невозможен:", *[f"  {k}: {n}" for k, n in found.items()], "Итог: 2"])
    deleted = session.execute(text(f"DELETE FROM {S}people WHERE id = ANY(:i)"), {"i": ids}).rowcount
    lines = [head, f"  team_people: {'удалено' if apply else 'будет удалено'} {deleted}"]
    if apply:
        log_action(session, None, ACTION_ROLLBACK, service.MODULE_ID, seed_audit_id=str(row.id), count=deleted)
        session.commit()
        return Report(0, lines + ["Итог: 0 — откат выполнен"])
    session.rollback()
    return Report(0, lines + ["Итог: 0 — можно запускать с --apply"])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.modules.team.seed", description="Разовая загрузка людей «Карты команды» из team.json")
    ap.add_argument("file", nargs="?", help="путь к team.json или «-» (stdin)")
    ap.add_argument("--apply", action="store_true", help="записать (по умолчанию сухой прогон)")
    ap.add_argument("--rollback", action="store_true", help="откатить последнюю загрузку (файл не нужен)")
    args = ap.parse_args(argv)
    if args.rollback == bool(args.file):
        print("Нужно одно из двух: FILE|- (загрузка) или --rollback (откат)", file=sys.stderr)
        return 1
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        with Session(get_engine()) as session:
            report = rollback_seed(session, apply=args.apply) if args.rollback else seed_people(session, args.file, apply=args.apply)
    except Exception as e:  # noqa: BLE001 — текст исключения может содержать ПДн, печатаем только тип
        print(f"Непредвиденная ошибка: {type(e).__name__}", file=sys.stderr)
        return 1
    print(report.text())
    return report.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
