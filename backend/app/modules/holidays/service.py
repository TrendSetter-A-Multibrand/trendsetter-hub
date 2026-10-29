"""Модуль «Производственный календарь»: праздники и переносы РФ и Армении (таблица holidays_days, db/16_holidays.sql).

В БД хранятся только исключения: одна строка = один день одной страны. Суббота и воскресенье без строки — выходной, пн-пт без строки — рабочий;
эти правила и «периоды отдыха» считает фронтенд (modules/holidays/lib/holidays.js), бэкенд только хранит, отдаёт строки и проверяет запись.
Виды: holiday (название обязательно), day_off (перенос выходного), workday (рабочий день — только сб/вс), short (сокращённый рабочий день).
Читатель — view/run на holidays (viewer — нет). Редактор — «Ответственный» на holidays или администратор (is_editor).
Запись — диапазоном не больше 31 дня, upsert; нарушение правила в любом дне диапазона — 422 на весь диапазон, ничего не пишется.
В журнал (log_action, module_id='holidays') пишутся country, start, end, kind, count — названия праздников не пишутся.
TODO(Q-HC1): выходные — сб и вс для обеих стран; шестидневка не учитывается. TODO(Q-HC3): superuser без явного права не редактор.
TODO(Q-HC4): защиты от одновременной правки нет, последняя запись побеждает.
"""
from datetime import date, timedelta

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.access import can_manage_users, can_see_data
from app.core.audit import log_action
from app.core.deps import module_rights
from app.core.models import User

MODULE_ID = "holidays"
TABLE = "trendsetter_hub.holidays_days"

MSG_RANGE_ORDER = "Дата окончания раньше даты начала"
MSG_RANGE_TOO_LONG = "Не больше 31 дня за один раз"
MSG_PERIOD_TOO_LONG = "Период не больше 400 дней"
MSG_DATES_OUT_OF_RANGE = "Даты должны быть в пределах 2000–2100 годов"
MSG_NAME_REQUIRED = "Укажите название праздника"
MSG_WORKDAY_WEEKEND = "Рабочим днём (перенос) можно отметить только субботу или воскресенье"

MIN_DAY = date(2000, 1, 1)
MAX_DAY = date(2100, 12, 31)
MAX_WRITE_DAYS = 31
MAX_READ_DAYS = 400
MAX_BAD_DATES = 5


def fail(status: int, message: str):
    raise HTTPException(status, message)


# ---------- права ----------


def access_of(session: Session, user: User) -> str:
    return module_rights(session, user, [MODULE_ID])[MODULE_ID][0]


def can_read(access: str) -> bool:
    """Читатель: view или run (viewer на for_all-модуле имеет structure — не читатель)."""
    return can_see_data(access)


# TODO(Q-HC3): superuser без явного права не редактор
def is_editor(session: Session, user: User) -> bool:
    return module_rights(session, user, [MODULE_ID])[MODULE_ID][1] or can_manage_users(
        access_level=user.access_level, is_active=user.is_active
    )


# ---------- проверки ----------


def _check_bounds(start: date, end: date) -> None:
    if start < MIN_DAY or end < MIN_DAY or start > MAX_DAY or end > MAX_DAY:
        fail(422, MSG_DATES_OUT_OF_RANGE)


def _check_write_range(start: date, end: date) -> None:
    _check_bounds(start, end)
    if end < start:
        fail(422, MSG_RANGE_ORDER)
    if (end - start).days + 1 > MAX_WRITE_DAYS:
        fail(422, MSG_RANGE_TOO_LONG)


def _check_workday(start: date, end: date) -> None:
    days = (start + timedelta(days=i) for i in range((end - start).days + 1))
    bad = [d for d in days if d.isoweekday() < 6]
    if bad:
        dates = ", ".join(d.strftime("%d.%m.%Y") for d in bad[:MAX_BAD_DATES])
        fail(422, f"{MSG_WORKDAY_WEEKEND}: {dates}")


# ---------- чтение и запись ----------


def _rows(session: Session, start: date, end: date, country: str | None = None) -> list[dict]:
    sql = f"SELECT country, day, kind, name FROM {TABLE} WHERE day BETWEEN :s AND :e"
    params: dict = {"s": start, "e": end}
    if country:
        sql += " AND country = :c"
        params["c"] = country
    rows = session.execute(text(sql + " ORDER BY country, day"), params).mappings().all()
    return [{"country": r["country"], "date": r["day"].isoformat(), "kind": r["kind"], "name": r["name"]} for r in rows]


def list_days(session: Session, start: date, end: date) -> dict:
    _check_bounds(start, end)
    if end < start:
        fail(422, MSG_RANGE_ORDER)
    if (end - start).days > MAX_READ_DAYS:
        fail(422, MSG_PERIOD_TOO_LONG)
    return {"start": start.isoformat(), "end": end.isoformat(), "days": _rows(session, start, end)}


def set_days(session: Session, user: User, country: str, start: date, end: date, kind: str, name: str | None) -> dict:
    _check_write_range(start, end)
    if kind == "holiday" and name is None:
        fail(422, MSG_NAME_REQUIRED)
    if kind == "workday":
        _check_workday(start, end)
    count = (end - start).days + 1
    session.execute(
        text(
            f"INSERT INTO {TABLE} (country, day, kind, name, updated_by) "
            "SELECT :c, d::date, :k, :n, :u FROM generate_series(CAST(:s AS date), CAST(:e AS date), interval '1 day') AS d "
            "ON CONFLICT (country, day) DO UPDATE SET kind = EXCLUDED.kind, name = EXCLUDED.name, "
            "updated_by = EXCLUDED.updated_by, updated_at = now()"
        ),
        {"c": country, "k": kind, "n": name, "u": user.id, "s": start, "e": end},
    )
    log_action(session, user.id, "holidays.set", MODULE_ID, country=country, start=start.isoformat(), end=end.isoformat(), kind=kind, count=count)
    session.commit()
    return {"days": _rows(session, start, end, country)}


def delete_days(session: Session, user: User, country: str, start: date, end: date) -> dict:
    _check_write_range(start, end)
    count = session.execute(
        text(f"DELETE FROM {TABLE} WHERE country = :c AND day BETWEEN :s AND :e"), {"c": country, "s": start, "e": end}
    ).rowcount
    if count > 0:
        log_action(session, user.id, "holidays.delete", MODULE_ID, country=country, start=start.isoformat(), end=end.isoformat(), count=count)
    session.commit()
    return {"count": count}
