"""HR: годовой график отпусков (плановые периоды). Сотрудник — свои, руководитель — подчинённых, HR — все.
Из планового периода одним действием создаётся обычная заявка на отпуск (поток согласования — как есть).
В журнал пишутся только id."""
from datetime import date

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core import messages as m
from app.core.audit import log_action
from app.core.models import User
from app.modules.hr import service as hr
from app.modules.team import service as team_service

COMMENT_LIMIT = 300
MSG_YEAR = "Укажите год (2000–2100)"
MSG_PAST = "Нельзя планировать прошедшие даты"
MSG_FAR = "Планировать можно не дальше следующего года"
MSG_OVERLAP = "Этот период пересекается с другим вашим планом"
MSG_COMMENT = f"Комментарий не длиннее {COMMENT_LIMIT} символов"
MSG_PLAN_NOT_FOUND = "План не найден"
MSG_PLAN_NOT_ACTIVE = "План уже отменён или превращён в заявку"

PLAN_SQL = f"SELECT id, person_id, start_date, end_date, comment, status, request_id FROM {hr.H}leave_plans"


def _year(year: int | None) -> tuple[date, date]:
    y = year if year is not None else date.today().year
    if not 2000 <= y <= 2100:
        hr.fail(422, MSG_YEAR)
    return date(y, 1, 1), date(y, 12, 31)


def _own_person(session: Session, user: User) -> int:
    pid = team_service.resolve_own_person(session, user)
    if pid is None:
        hr.fail(422, hr.MSG_NO_PERSON)
    return pid


def _out(r) -> dict:
    return {
        "id": r["id"], "start": r["start_date"].isoformat(), "end": r["end_date"].isoformat(), "comment": r["comment"], "status": r["status"],
        "requestId": r["request_id"],
    }


def my_plans(session: Session, user: User, year: int | None) -> list[dict]:
    first, last = _year(year)
    pid = team_service.resolve_own_person(session, user)
    if pid is None:
        return []
    rows = session.execute(
        text(PLAN_SQL + " WHERE person_id = :p AND start_date <= :l AND end_date >= :f ORDER BY start_date, id"), {"p": pid, "f": first, "l": last}
    ).mappings().all()
    return [_out(r) for r in rows]


def create_plan(session: Session, user: User, d: dict) -> dict:
    pid = _own_person(session, user)
    hr._person(session, pid, lock=True)  # замок на человека: пересечения не обходятся параллельными запросами
    start, end = hr._date(d.get("start")), hr._date(d.get("end"))
    if end < start:
        hr.fail(422, hr.MSG_DATES)
    today = date.today()
    if start < today:
        hr.fail(422, MSG_PAST)
    if end.year > today.year + 1:
        hr.fail(422, MSG_FAR)
    comment = d.get("comment")
    if comment is not None and (not isinstance(comment, str) or len(comment.strip()) > COMMENT_LIMIT):
        hr.fail(422, MSG_COMMENT)
    clash = session.execute(
        text(f"SELECT 1 FROM {hr.H}leave_plans WHERE person_id = :p AND status = 'planned' AND start_date <= :e AND end_date >= :s LIMIT 1"),
        {"p": pid, "s": start, "e": end},
    ).first()
    if clash:
        hr.fail(409, MSG_OVERLAP)
    plan_id = session.execute(
        text(f"INSERT INTO {hr.H}leave_plans (person_id, start_date, end_date, comment, created_by) VALUES (:p, :s, :e, :c, :u) RETURNING id"),
        {"p": pid, "s": start, "e": end, "c": (comment or "").strip() or None, "u": user.id},
    ).scalar_one()
    log_action(session, user.id, "hr.plan_add", hr.MODULE_ID, plan_id=plan_id, person_id=pid)
    session.commit()
    return _out(session.execute(text(PLAN_SQL + " WHERE id = :i"), {"i": plan_id}).mappings().one())


def _own_plan(session: Session, user: User, plan_id: int):
    pid = team_service.resolve_own_person(session, user)
    row = session.execute(text(PLAN_SQL + " WHERE id = :i FOR UPDATE"), {"i": plan_id}).mappings().first()
    if row is None or pid is None or row["person_id"] != pid:
        hr.fail(404, MSG_PLAN_NOT_FOUND)
    if row["status"] != "planned":
        hr.fail(409, MSG_PLAN_NOT_ACTIVE)
    return row


def cancel_plan(session: Session, user: User, plan_id: int) -> dict:
    row = _own_plan(session, user, plan_id)
    session.execute(text(f"UPDATE {hr.H}leave_plans SET status = 'cancelled' WHERE id = :i"), {"i": plan_id})
    log_action(session, user.id, "hr.plan_cancel", hr.MODULE_ID, plan_id=plan_id, person_id=row["person_id"])
    session.commit()
    return _out(session.execute(text(PLAN_SQL + " WHERE id = :i"), {"i": plan_id}).mappings().one())


def convert_plan(session: Session, user: User, plan_id: int, d: dict) -> dict:
    """Заявка создаётся обычным путём (create_my_request: даты в прошлом — 422, пересечения — 409); затем план получает статус converted."""
    row = _own_plan(session, user, plan_id)
    request = hr.create_my_request(
        session, user, {"kind": d.get("kind") or "annual", "start": row["start_date"].isoformat(), "end": row["end_date"].isoformat(), "message": d.get("message")}
    )
    session.execute(text(f"UPDATE {hr.H}leave_plans SET status = 'converted', request_id = :r WHERE id = :i"), {"r": request["id"], "i": plan_id})
    log_action(session, user.id, "hr.plan_convert", hr.MODULE_ID, plan_id=plan_id, person_id=row["person_id"], request_id=request["id"])
    session.commit()
    return {**_out(session.execute(text(PLAN_SQL + " WHERE id = :i"), {"i": plan_id}).mappings().one()), "request": request}


def team_plans(session: Session, user: User, year: int | None) -> list[dict]:
    """План подчинённых (неотменённые). Руководитель — пользователь, привязанный (user_id) к карточке с неархивными подчинёнными."""
    first, last = _year(year)
    # Mgr — строго владелец карточки-руководителя (team_people.user_id), без привязки по почте/имени
    reports = session.execute(
        text(f"SELECT c.id FROM {hr.T}people c JOIN {hr.T}people m ON m.id = c.manager_id WHERE m.user_id = :u AND NOT c.is_archived"), {"u": user.id}
    ).scalars().all()
    if not reports:
        raise HTTPException(403, m.FORBIDDEN)
    rows = session.execute(
        text(
            f"""SELECT l.person_id, p.first_name, p.last_name, l.start_date, l.end_date, l.comment, l.status FROM {hr.H}leave_plans l
                JOIN {hr.T}people p ON p.id = l.person_id WHERE l.person_id = ANY(:ids) AND l.status <> 'cancelled'
                AND l.start_date <= :l AND l.end_date >= :f ORDER BY l.start_date, l.id"""
        ),
        {"ids": list(reports), "f": first, "l": last},
    ).mappings().all()
    return [
        {"personId": r["person_id"], "name": hr._name(r), "start": r["start_date"].isoformat(), "end": r["end_date"].isoformat(), "comment": r["comment"], "status": r["status"]}
        for r in rows
    ]


def all_plans(session: Session, year: int | None) -> list[dict]:
    first, last = _year(year)
    rows = session.execute(
        text(
            f"""SELECT l.id, l.person_id, p.first_name, p.last_name, p.direction_id, l.start_date, l.end_date, l.comment, l.status FROM {hr.H}leave_plans l
                JOIN {hr.T}people p ON p.id = l.person_id WHERE l.status <> 'cancelled' AND l.start_date <= :l AND l.end_date >= :f
                ORDER BY l.start_date, l.id"""
        ),
        {"f": first, "l": last},
    ).mappings().all()
    return [
        {
            "id": r["id"], "personId": r["person_id"], "name": hr._name(r), "directionId": r["direction_id"], "start": r["start_date"].isoformat(),
            "end": r["end_date"].isoformat(), "comment": r["comment"], "status": r["status"],
        }
        for r in rows
    ]
