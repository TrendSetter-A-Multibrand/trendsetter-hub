"""HR: история сотрудника (должность, руководитель, направление, статус, оклад, прочее).
Автозаписи делает record_auto из PATCH /modules/team/hr/people/{id}; записи вида salary видит и создаёт только responsible.
В журнал пишутся только id и вид записи, без значений."""
from datetime import date

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core import messages as m
from app.core.audit import log_action
from app.core.models import User
from app.modules.hr import service as hr

KINDS = ("position", "salary", "manager", "direction", "status", "other")
TITLE_LIMIT = 200
VALUE_LIMIT = 300
COMMENT_LIMIT = 1000
MSG_TITLE = f"Укажите заголовок записи (до {TITLE_LIMIT} символов)"
MSG_KIND = "Неизвестный вид записи"
MSG_VALUE = f"Значения не длиннее {VALUE_LIMIT} символов, комментарий — до {COMMENT_LIMIT}"
MSG_NOT_FOUND = "Запись не найдена"

HISTORY_SQL = f"""SELECT h.id, h.person_id, h.kind, h.effective_date, h.title, h.old_value, h.new_value, h.comment, h.auto, h.created_at,
       u.full_name AS creator FROM {hr.H}employee_history h LEFT JOIN {hr.U} u ON u.id = h.created_by"""


def _out(r) -> dict:
    return {
        "id": r["id"], "kind": r["kind"], "effectiveDate": r["effective_date"].isoformat(), "title": r["title"], "oldValue": r["old_value"],
        "newValue": r["new_value"], "comment": r["comment"], "auto": r["auto"], "createdBy": r["creator"], "createdAt": r["created_at"].isoformat(),
    }


def record_auto(session: Session, person_id: int, kind: str, title: str, old: str | None, new: str | None, actor_id: int | None) -> None:
    """Автозапись об изменении карточки (effective_date — сегодня). Коммитит вызывающий код."""
    session.execute(
        text(
            f"""INSERT INTO {hr.H}employee_history (person_id, kind, effective_date, title, old_value, new_value, auto, created_by)
                VALUES (:p, :k, :d, :t, :o, :n, true, :u)"""
        ),
        {"p": person_id, "k": kind, "d": date.today(), "t": title, "o": (old or None) and old[:VALUE_LIMIT], "n": (new or None) and new[:VALUE_LIMIT], "u": actor_id},
    )


def list_history(session: Session, user: User, person_id: int) -> list[dict]:
    hr._person(session, person_id)
    where = "" if hr.is_responsible(session, user) else " AND h.kind <> 'salary'"
    rows = session.execute(
        text(HISTORY_SQL + " WHERE h.person_id = :p" + where + " ORDER BY h.effective_date DESC, h.id DESC"), {"p": person_id}
    ).mappings().all()
    return [_out(r) for r in rows]


def _opt(d: dict, key: str, limit: int, message: str) -> str | None:
    v = d.get(key)
    if v is None:
        return None
    if not isinstance(v, str) or len(v.strip()) > limit:
        hr.fail(422, message)
    return v.strip() or None


def add_history(session: Session, user: User, person_id: int, d: dict) -> dict:
    hr._person(session, person_id, lock=True)
    kind = d.get("kind")
    if kind not in KINDS:
        hr.fail(422, MSG_KIND)
    if kind == "salary" and not hr.is_responsible(session, user):
        raise HTTPException(403, m.FORBIDDEN)
    title = d.get("title")
    title = title.strip() if isinstance(title, str) else ""
    if not 1 <= len(title) <= TITLE_LIMIT:
        hr.fail(422, MSG_TITLE)
    effective = hr._date(d.get("effectiveDate"))
    old = _opt(d, "oldValue", VALUE_LIMIT, MSG_VALUE)
    new = _opt(d, "newValue", VALUE_LIMIT, MSG_VALUE)
    comment = _opt(d, "comment", COMMENT_LIMIT, MSG_VALUE)
    history_id = session.execute(
        text(
            f"""INSERT INTO {hr.H}employee_history (person_id, kind, effective_date, title, old_value, new_value, comment, auto, created_by)
                VALUES (:p, :k, :d, :t, :o, :n, :c, false, :u) RETURNING id"""
        ),
        {"p": person_id, "k": kind, "d": effective, "t": title, "o": old, "n": new, "c": comment, "u": user.id},
    ).scalar_one()
    log_action(session, user.id, "hr.history_add", hr.MODULE_ID, history_id=history_id, person_id=person_id, kind=kind)
    session.commit()
    return _out(session.execute(text(HISTORY_SQL + " WHERE h.id = :i"), {"i": history_id}).mappings().one())


def delete_history(session: Session, user: User, history_id: int) -> dict:
    row = session.execute(text(f"SELECT person_id, kind, auto FROM {hr.H}employee_history WHERE id = :i FOR UPDATE"), {"i": history_id}).mappings().first()
    if row is None or (row["kind"] == "salary" and not hr.is_responsible(session, user)):
        hr.fail(404, MSG_NOT_FOUND)  # записи оклада для не-Resp «не существуют»
    if not hr.is_responsible(session, user) and row["auto"]:
        raise HTTPException(403, m.FORBIDDEN)
    session.execute(text(f"DELETE FROM {hr.H}employee_history WHERE id = :i"), {"i": history_id})
    log_action(session, user.id, "hr.history_delete", hr.MODULE_ID, history_id=history_id, person_id=row["person_id"], kind=row["kind"])
    session.commit()
    return {"ok": True}
