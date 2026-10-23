"""HR: учёт выданного оборудования. Права: run на hr. В журнал пишутся только id и вид; названия и серийные номера не пишутся."""
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core import messages as m
from app.core.audit import log_action
from app.core.models import User
from app.modules.hr import service as hr

KINDS = ("laptop", "phone", "monitor", "access_card", "peripheral", "other")
MAX_PER_PERSON = 100
NAME_LIMIT = 120
SERIAL_LIMIT = 100
COMMENT_LIMIT = 500
MSG_KIND = "Неизвестный вид оборудования"
MSG_NAME = f"Введите название (до {NAME_LIMIT} символов)"
MSG_TEXT = f"Серийный номер — до {SERIAL_LIMIT} символов, комментарий — до {COMMENT_LIMIT}"
MSG_LIMIT = f"У сотрудника уже {MAX_PER_PERSON} записей об оборудовании: удалите ненужные"
MSG_NOT_FOUND = "Запись не найдена"

COLS = {"kind": "kind", "name": "name", "serial": "serial", "issuedAt": "issued_at", "returnDue": "return_due", "returnedAt": "returned_at", "comment": "comment"}
SQL = f"SELECT id, person_id, kind, name, serial, issued_at, return_due, returned_at, comment FROM {hr.H}equipment"


def _out(r) -> dict:
    iso = lambda v: v.isoformat() if v else None  # noqa: E731
    return {
        "id": r["id"], "kind": r["kind"], "name": r["name"], "serial": r["serial"], "issuedAt": iso(r["issued_at"]),
        "returnDue": iso(r["return_due"]), "returnedAt": iso(r["returned_at"]), "comment": r["comment"],
    }


def _clean(key: str, value):
    if key == "kind":
        if value not in KINDS:
            hr.fail(422, MSG_KIND)
        return value
    if key == "name":
        v = value.strip() if isinstance(value, str) else ""
        if not 1 <= len(v) <= NAME_LIMIT:
            hr.fail(422, MSG_NAME)
        return v
    if key in ("serial", "comment"):
        if value is None:
            return None
        if not isinstance(value, str) or len(value.strip()) > (SERIAL_LIMIT if key == "serial" else COMMENT_LIMIT):
            hr.fail(422, MSG_TEXT)
        return value.strip() or None
    return hr._date(value, required=key == "issuedAt")


def list_equipment(session: Session, person_id: int) -> list[dict]:
    hr._person(session, person_id)
    rows = session.execute(text(SQL + " WHERE person_id = :p ORDER BY issued_at DESC, id DESC"), {"p": person_id}).mappings().all()
    return [_out(r) for r in rows]


def add_equipment(session: Session, user: User, person_id: int, d: dict) -> dict:
    hr._person(session, person_id, lock=True)  # замок на человека: лимит не обходится параллельными запросами
    cols = {COLS[k]: _clean(k, d.get(k)) for k in ("kind", "name", "serial", "issuedAt", "returnDue", "comment")}
    count = session.execute(text(f"SELECT count(*) FROM {hr.H}equipment WHERE person_id = :p"), {"p": person_id}).scalar_one()
    if count >= MAX_PER_PERSON:
        hr.fail(409, MSG_LIMIT)
    names = list(cols)
    item_id = session.execute(
        text(f"INSERT INTO {hr.H}equipment (person_id, created_by, {', '.join(names)}) VALUES (:person_id, :created_by, {', '.join(':' + n for n in names)}) RETURNING id"),
        {**cols, "person_id": person_id, "created_by": user.id},
    ).scalar_one()
    log_action(session, user.id, "hr.equipment_add", hr.MODULE_ID, equipment_id=item_id, person_id=person_id, kind=cols["kind"])
    session.commit()
    return _out(session.execute(text(SQL + " WHERE id = :i"), {"i": item_id}).mappings().one())


def update_equipment(session: Session, user: User, item_id: int, d: dict) -> dict:
    row = session.execute(text(SQL + " WHERE id = :i FOR UPDATE"), {"i": item_id}).mappings().first()
    if row is None:
        hr.fail(404, MSG_NOT_FOUND)
    if set(d) - set(COLS):
        hr.fail(422, m.INVALID)
    cols = {COLS[k]: _clean(k, v) for k, v in d.items() if not (v is None and k in ("kind", "name", "issuedAt"))}
    if any(v is None and k in ("kind", "name", "issuedAt") for k, v in d.items()):
        hr.fail(422, MSG_NAME)
    if cols:
        session.execute(text(f"UPDATE {hr.H}equipment SET {', '.join(f'{c} = :{c}' for c in cols)} WHERE id = :_id"), {**cols, "_id": item_id})
        log_action(session, user.id, "hr.equipment_update", hr.MODULE_ID, equipment_id=item_id, person_id=row["person_id"], fields=sorted(d))
        session.commit()
    return _out(session.execute(text(SQL + " WHERE id = :i"), {"i": item_id}).mappings().one())


def delete_equipment(session: Session, user: User, item_id: int) -> dict:
    row = session.execute(text(f"SELECT person_id FROM {hr.H}equipment WHERE id = :i FOR UPDATE"), {"i": item_id}).mappings().first()
    if row is None:
        hr.fail(404, MSG_NOT_FOUND)
    session.execute(text(f"DELETE FROM {hr.H}equipment WHERE id = :i"), {"i": item_id})
    log_action(session, user.id, "hr.equipment_delete", hr.MODULE_ID, equipment_id=item_id, person_id=row["person_id"])
    session.commit()
    return {"ok": True}
