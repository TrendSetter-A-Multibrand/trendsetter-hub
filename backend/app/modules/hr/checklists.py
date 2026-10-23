"""HR: шаблоны и чек-листы онбординга/оффбординга. Права: шаблоны и запуск — run на hr; исполнитель пункта (не HR) может отмечать только свой пункт.
В журнал пишутся только id и вид; названия пунктов и заметки не пишутся."""
from datetime import date, timedelta

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core import messages as m
from app.core.audit import log_action
from app.core.models import User
from app.core.notifications import notify
from app.modules.hr import service as hr

KINDS = ("onboarding", "offboarding")
TEMPLATE_TITLE_LIMIT = 120
ITEM_TITLE_LIMIT = 200
NOTE_LIMIT = 500
MAX_ITEMS = 50
OFFSET_LIMIT = 365
LINK = "/modules/hr"
MSG_KIND = "Неизвестный вид чек-листа"
MSG_TEMPLATE_TITLE = f"Введите название шаблона (до {TEMPLATE_TITLE_LIMIT} символов)"
MSG_ITEMS = f"Пунктов от 1 до {MAX_ITEMS}; название пункта — до {ITEM_TITLE_LIMIT} символов, срок — число дней от 0 до {OFFSET_LIMIT}"
MSG_TEMPLATE_NOT_FOUND = "Шаблон не найден"
MSG_TEMPLATE_INACTIVE = "Шаблон отключён"
MSG_CHECKLIST_NOT_FOUND = "Чек-лист не найден"
MSG_ITEM_NOT_FOUND = "Пункт не найден"
MSG_NOT_ACTIVE = "Чек-лист уже закрыт"
MSG_ASSIGNEE = "Исполнитель не найден"
MSG_NOTE = f"Заметка не длиннее {NOTE_LIMIT} символов"
MSG_DONE = "Отметка выполнения: да или нет"


# ---------- шаблоны ----------


def _template_out(session: Session, ids: list[int] | None = None) -> list[dict]:
    where = " WHERE id = ANY(:ids)" if ids is not None else ""
    rows = session.execute(text(f"SELECT id, kind, title, active FROM {hr.H}checklist_templates{where} ORDER BY kind, id"), {"ids": ids} if ids is not None else {}).mappings().all()
    items = session.execute(
        text(f"SELECT id, template_id, title, sort, days_offset FROM {hr.H}checklist_template_items WHERE template_id = ANY(:t) ORDER BY sort, id"),
        {"t": [r["id"] for r in rows]},
    ).mappings().all()
    return [
        {
            "id": r["id"], "kind": r["kind"], "title": r["title"], "active": r["active"],
            "items": [{"id": i["id"], "title": i["title"], "sort": i["sort"], "daysOffset": i["days_offset"]} for i in items if i["template_id"] == r["id"]],
        }
        for r in rows
    ]


def list_templates(session: Session) -> list[dict]:
    return _template_out(session)


def _clean_title(value, limit: int, message: str) -> str:
    v = value.strip() if isinstance(value, str) else ""
    if not 1 <= len(v) <= limit:
        hr.fail(422, message)
    return v


def _clean_items(items) -> list[tuple[str, int | None]]:
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_ITEMS:
        hr.fail(422, MSG_ITEMS)
    out = []
    for item in items:
        if not isinstance(item, dict):
            hr.fail(422, MSG_ITEMS)
        offset = item.get("daysOffset")
        if offset is not None and (not isinstance(offset, int) or isinstance(offset, bool) or not 0 <= offset <= OFFSET_LIMIT):
            hr.fail(422, MSG_ITEMS)
        out.append((_clean_title(item.get("title"), ITEM_TITLE_LIMIT, MSG_ITEMS), offset))
    return out


def _replace_items(session: Session, template_id: int, items: list[tuple[str, int | None]]) -> None:
    session.execute(text(f"DELETE FROM {hr.H}checklist_template_items WHERE template_id = :t"), {"t": template_id})
    for sort, (title, offset) in enumerate(items, 1):
        session.execute(
            text(f"INSERT INTO {hr.H}checklist_template_items (template_id, title, sort, days_offset) VALUES (:t, :ti, :s, :o)"),
            {"t": template_id, "ti": title, "s": sort, "o": offset},
        )


def create_template(session: Session, user: User, d: dict) -> dict:
    if d.get("kind") not in KINDS:
        hr.fail(422, MSG_KIND)
    title = _clean_title(d.get("title"), TEMPLATE_TITLE_LIMIT, MSG_TEMPLATE_TITLE)
    items = _clean_items(d.get("items"))
    template_id = session.execute(
        text(f"INSERT INTO {hr.H}checklist_templates (kind, title) VALUES (:k, :t) RETURNING id"), {"k": d["kind"], "t": title}
    ).scalar_one()
    _replace_items(session, template_id, items)
    log_action(session, user.id, "hr.template_update", hr.MODULE_ID, template_id=template_id, created=True)
    session.commit()
    return _template_out(session, [template_id])[0]


def update_template(session: Session, user: User, template_id: int, d: dict) -> dict:
    if session.execute(text(f"SELECT id FROM {hr.H}checklist_templates WHERE id = :i FOR UPDATE"), {"i": template_id}).first() is None:
        hr.fail(404, MSG_TEMPLATE_NOT_FOUND)
    sets = {}
    if "title" in d:
        sets["title"] = _clean_title(d["title"], TEMPLATE_TITLE_LIMIT, MSG_TEMPLATE_TITLE)
    if "active" in d:
        if not isinstance(d["active"], bool):
            hr.fail(422, m.INVALID)
        sets["active"] = d["active"]
    items = _clean_items(d["items"]) if "items" in d else None
    if sets:
        session.execute(text(f"UPDATE {hr.H}checklist_templates SET {', '.join(f'{c} = :{c}' for c in sets)} WHERE id = :_id"), {**sets, "_id": template_id})
    if items is not None:
        _replace_items(session, template_id, items)
    if sets or items is not None:
        log_action(session, user.id, "hr.template_update", hr.MODULE_ID, template_id=template_id, fields=sorted(d))
        session.commit()
    return _template_out(session, [template_id])[0]


# ---------- чек-листы ----------

ITEM_SQL = f"""SELECT i.id, i.checklist_id, i.title, i.sort, i.assignee_user_id, a.full_name AS assignee_name, i.due_date, i.done, i.done_at,
       d.full_name AS done_by_name, i.note FROM {hr.H}checklist_items i
       LEFT JOIN {hr.U} a ON a.id = i.assignee_user_id LEFT JOIN {hr.U} d ON d.id = i.done_by"""


def _item_out(r) -> dict:
    return {
        "id": r["id"], "title": r["title"], "sort": r["sort"],
        "assignee": {"id": r["assignee_user_id"], "name": r["assignee_name"]} if r["assignee_user_id"] is not None else None,
        "dueDate": r["due_date"].isoformat() if r["due_date"] else None, "done": r["done"],
        "doneAt": r["done_at"].isoformat() if r["done_at"] else None, "doneBy": r["done_by_name"], "note": r["note"],
    }


def _checklists_out(session: Session, where: str, params: dict) -> list[dict]:
    rows = session.execute(
        text(f"SELECT id, person_id, kind, title, status, started_at FROM {hr.H}checklists WHERE {where} ORDER BY started_at DESC, id DESC"), params
    ).mappings().all()
    items = session.execute(text(ITEM_SQL + " WHERE i.checklist_id = ANY(:c) ORDER BY i.sort, i.id"), {"c": [r["id"] for r in rows]}).mappings().all()
    return [
        {
            "id": r["id"], "personId": r["person_id"], "kind": r["kind"], "title": r["title"], "status": r["status"],
            "startedAt": r["started_at"].isoformat(), "items": [_item_out(i) for i in items if i["checklist_id"] == r["id"]],
        }
        for r in rows
    ]


def list_for_person(session: Session, person_id: int) -> list[dict]:
    hr._person(session, person_id)
    return _checklists_out(session, "person_id = :p", {"p": person_id})


def start_checklist(session: Session, user: User, person_id: int, d: dict) -> dict:
    hr._person(session, person_id, lock=True)
    template_id = d.get("templateId")
    tpl = session.execute(text(f"SELECT id, kind, title, active FROM {hr.H}checklist_templates WHERE id = :i"), {"i": template_id if isinstance(template_id, int) else 0}).mappings().first()
    if tpl is None:
        hr.fail(404, MSG_TEMPLATE_NOT_FOUND)
    if not tpl["active"]:
        hr.fail(422, MSG_TEMPLATE_INACTIVE)
    started = hr._date(d.get("startedAt"), required=False) or date.today()
    checklist_id = session.execute(
        text(
            f"""INSERT INTO {hr.H}checklists (person_id, kind, title, template_id, started_at, created_by)
                VALUES (:p, :k, :t, :tp, :s, :u) RETURNING id"""
        ),
        {"p": person_id, "k": tpl["kind"], "t": tpl["title"], "tp": tpl["id"], "s": started, "u": user.id},
    ).scalar_one()
    rows = session.execute(
        text(f"SELECT title, sort, days_offset FROM {hr.H}checklist_template_items WHERE template_id = :t ORDER BY sort, id"), {"t": tpl["id"]}
    ).mappings().all()
    for r in rows:
        due = started + timedelta(days=r["days_offset"]) if r["days_offset"] is not None else None
        session.execute(
            text(f"INSERT INTO {hr.H}checklist_items (checklist_id, title, sort, due_date) VALUES (:c, :t, :s, :d)"),
            {"c": checklist_id, "t": r["title"], "s": r["sort"], "d": due},
        )
    log_action(session, user.id, "hr.checklist_start", hr.MODULE_ID, checklist_id=checklist_id, person_id=person_id, kind=tpl["kind"], template_id=tpl["id"])
    session.commit()
    return _checklists_out(session, "id = :i", {"i": checklist_id})[0]


def _checklist(session: Session, checklist_id: int):
    row = session.execute(text(f"SELECT id, person_id, kind, title, status FROM {hr.H}checklists WHERE id = :i FOR UPDATE"), {"i": checklist_id}).mappings().first()
    if row is None:
        hr.fail(404, MSG_CHECKLIST_NOT_FOUND)
    return row


def _finish(session: Session, checklist, status: str) -> None:
    session.execute(text(f"UPDATE {hr.H}checklists SET status = :s, closed_at = now() WHERE id = :i"), {"s": status, "i": checklist["id"]})


def close_checklist(session: Session, user: User, checklist_id: int, status: str) -> dict:
    checklist = _checklist(session, checklist_id)
    if checklist["status"] != "active":
        hr.fail(409, MSG_NOT_ACTIVE)
    _finish(session, checklist, status)
    log_action(session, user.id, "hr.checklist_close" if status == "done" else "hr.checklist_cancel", hr.MODULE_ID, checklist_id=checklist_id, person_id=checklist["person_id"])
    session.commit()
    return _checklists_out(session, "id = :i", {"i": checklist_id})[0]


def update_item(session: Session, user: User, item_id: int, d: dict) -> dict:
    item = session.execute(text(f"SELECT id, checklist_id, title, assignee_user_id, done FROM {hr.H}checklist_items WHERE id = :i"), {"i": item_id}).mappings().first()
    if item is None:
        hr.fail(404, MSG_ITEM_NOT_FOUND)
    is_hr = hr.is_hr(session, user)
    if not is_hr:
        if item["assignee_user_id"] != user.id:
            hr.fail(404, MSG_ITEM_NOT_FOUND)  # чужие пункты для не-HR «не существуют»
        if set(d) - {"done", "note"}:
            raise HTTPException(403, m.FORBIDDEN)
    checklist = _checklist(session, item["checklist_id"])
    if checklist["status"] != "active":
        hr.fail(409, MSG_NOT_ACTIVE)
    sets = {}
    raw = []  # готовые фрагменты SQL без параметров
    if "done" in d:
        if not isinstance(d["done"], bool):
            hr.fail(422, MSG_DONE)
        sets.update(done=d["done"], done_by=user.id if d["done"] else None)
        raw.append("done_at = now()" if d["done"] else "done_at = NULL")
    if "note" in d:
        note = d["note"]
        if note is not None and (not isinstance(note, str) or len(note.strip()) > NOTE_LIMIT):
            hr.fail(422, MSG_NOTE)
        sets["note"] = (note or "").strip() or None
    new_assignee = None
    if "assigneeUserId" in d:
        uid = d["assigneeUserId"]
        if uid is not None:
            active = session.scalar(select(User.id).where(User.id == uid, User.is_active.is_(True))) if isinstance(uid, int) else None
            if active is None:
                hr.fail(422, MSG_ASSIGNEE)
        sets["assignee_user_id"] = uid
        if uid is not None and uid != item["assignee_user_id"] and uid != user.id:
            new_assignee = uid
    if "dueDate" in d:
        sets["due_date"] = hr._date(d["dueDate"], required=False)
    if sets:
        assignments = ", ".join([f"{c} = :{c}" for c in sets] + raw)
        session.execute(text(f"UPDATE {hr.H}checklist_items SET {assignments} WHERE id = :_id"), {**sets, "_id": item_id})
        if new_assignee is not None:
            person = hr._person(session, checklist["person_id"])
            notify(session, [new_assignee], "checklist_assigned", "Вам назначен пункт чек-листа", f"{hr._name(person)}: {item['title']}", LINK)
        log_action(session, user.id, "hr.checklist_item", hr.MODULE_ID, item_id=item_id, checklist_id=checklist["id"], fields=sorted(d))
        if "done" in d and d["done"]:
            left = session.execute(text(f"SELECT 1 FROM {hr.H}checklist_items WHERE checklist_id = :c AND NOT done LIMIT 1"), {"c": checklist["id"]}).first()
            if left is None:
                _finish(session, checklist, "done")
                person = hr._person(session, checklist["person_id"])
                notify(session, hr.hr_user_ids(session), "checklist_done", "Чек-лист завершён", f"{hr._name(person)}: {checklist['title']}", LINK)
        session.commit()
    return _item_out(session.execute(text(ITEM_SQL + " WHERE i.id = :i"), {"i": item_id}).mappings().one())


def my_items(session: Session, user: User) -> list[dict]:
    rows = session.execute(
        text(
            f"""SELECT i.id, i.checklist_id, i.title, i.due_date, i.done, c.title AS checklist_title, p.first_name, p.last_name
                FROM {hr.H}checklist_items i JOIN {hr.H}checklists c ON c.id = i.checklist_id JOIN {hr.T}people p ON p.id = c.person_id
                WHERE i.assignee_user_id = :u AND c.status = 'active' ORDER BY i.done, i.due_date NULLS LAST, i.id"""
        ),
        {"u": user.id},
    ).mappings().all()
    return [
        {
            "checklistId": r["checklist_id"], "itemId": r["id"], "personName": hr._name(r), "checklistTitle": r["checklist_title"], "title": r["title"],
            "dueDate": r["due_date"].isoformat() if r["due_date"] else None, "done": r["done"],
        }
        for r in rows
    ]


def overview(session: Session, status: str) -> list[dict]:
    """Обзор чек-листов для вкладки HR: прогресс и число просроченных пунктов; сначала с просрочкой, затем по дате старта."""
    if status != "all" and status not in ("active", "done", "cancelled"):
        hr.fail(422, m.INVALID)
    where = "" if status == "all" else "WHERE c.status = :s"
    params = {"t": date.today(), **({} if status == "all" else {"s": status})}
    overdue = "count(i.id) FILTER (WHERE NOT i.done AND i.due_date < :t)"
    rows = session.execute(
        text(
            f"""SELECT c.id, c.person_id, c.kind, c.title, c.status, c.started_at, p.first_name, p.last_name,
                count(i.id) FILTER (WHERE i.done) AS done, count(i.id) AS total, {overdue} AS overdue
                FROM {hr.H}checklists c JOIN {hr.T}people p ON p.id = c.person_id LEFT JOIN {hr.H}checklist_items i ON i.checklist_id = c.id
                {where} GROUP BY c.id, p.first_name, p.last_name ORDER BY ({overdue} > 0) DESC, c.started_at, c.id"""
        ),
        params,
    ).mappings().all()
    return [
        {
            "id": r["id"], "personId": r["person_id"], "personName": hr._name(r), "kind": r["kind"], "title": r["title"], "status": r["status"],
            "startedAt": r["started_at"].isoformat(), "progress": {"done": r["done"], "total": r["total"]}, "overdue": r["overdue"],
        }
        for r in rows
    ]
