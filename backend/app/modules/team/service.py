"""Модуль «Карта команды»: карточки людей, анкета сотрудника с модерацией HR, конструктор полей анкеты.

Таблицы team_* в схеме trendsetter_hub (db/04_team.sql). Права: просмотр — доступ к модулю team (structure видит только схему),
HR — право run на модуль hr (module_rights). Фото хранятся в БД (JPEG, bytea) и отдаются data:-URL (<img> не умеет Bearer).
В журнал (log_action) пишутся только id и имена изменённых полей — значения анкеты (ПДн) не пишутся.
"""
import base64
import binascii
import json
import re

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import messages as m
from app.core.access import can_see_data
from app.core.audit import log_action
from app.core.deps import module_rights
from app.core.models import User

MODULE_ID = "team"
HR_MODULE = "hr"
S = "trendsetter_hub.team_"

JPEG_PREFIX = "data:image/jpeg;base64,"
JPEG_MAGIC = b"\xff\xd8\xff"
FULL_LIMIT = 300 * 1024
THUMB_LIMIT = 30 * 1024

COLUMN_KEYS = ("first_name", "last_name", "title", "email")  # значения этих полей пишутся в колонки карточки, остальные — в answers
KINDS = ("text", "textarea", "select", "chips", "links", "photo")
KEY_RE = re.compile(r"^[a-z][a-z0-9_]{1,40}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

MSG_NO_ACCESS = m.FORBIDDEN
MSG_PERSON_NOT_FOUND = "Сотрудник не найден"
MSG_SUBMISSION_NOT_FOUND = "Заявка не найдена"
MSG_FIELD_NOT_FOUND = "Поле не найдено"
MSG_DIRECTION_NOT_FOUND = "Направление не найдено"
MSG_MANAGER_NOT_FOUND = "Руководитель не найден"
MSG_NO_PENDING = "Нет заявки на проверке"
MSG_PENDING_EXISTS = "Заявка уже отправлена и ждёт проверки"
MSG_NOT_PENDING = "Заявка уже обработана"
MSG_PHOTO_REQUIRED = "Добавьте фото"
MSG_PHOTO_BAD = "Фото должно быть JPEG в формате data-URL"
MSG_PHOTO_BIG = "Фото слишком большое"
MSG_MANAGER_REQUIRED = "Укажите руководителя"
MSG_DIRECTION_REQUIRED = "Укажите направление"
MSG_CYCLE = "Нельзя назначить руководителем самого себя или своего подчинённого"
MSG_REASSIGN = "Сначала переназначьте подчинённых"
MSG_CEO_MANAGER = "Нельзя изменить руководителя CEO"
MSG_CEO_ARCHIVE = "Нельзя архивировать CEO"
MSG_EMAIL_DUPLICATE = "Эта почта уже есть в карте"
MSG_USER_LINKED = "Пользователь уже привязан к другой карточке"
MSG_COMMENT = "Укажите причину отказа (до 500 символов)"
MSG_FIELD_DUPLICATE = "Поле с таким ключом уже есть"
MSG_KEY_INVALID = "Ключ: латиница в нижнем регистре, цифры и «_», от 2 до 41 символа, начинается с буквы"
MSG_SYSTEM_HIDE = "Системное поле нельзя скрыть"
MSG_PHOTO_FIELD = "Поле с фото — только системное"


def fail(status: int, message: str):
    raise HTTPException(status, message)


# ---------- права ----------


def team_access(session: Session, user: User) -> str:
    return module_rights(session, user, [MODULE_ID])[MODULE_ID][0]


def is_hr(session: Session, user: User) -> bool:
    return module_rights(session, user, [HR_MODULE])[HR_MODULE][0] == "run"


def pending_badge(session: Session, user: User) -> int:
    """Бейдж модуля hr: число заявок на проверке, только если у пользователя право run на hr."""
    if not is_hr(session, user):
        return 0
    return session.execute(text(f"SELECT count(*) FROM {S}submissions WHERE status = 'pending'")).scalar_one()


# ---------- общие функции ----------


def _data_url(raw) -> str | None:
    return None if raw is None else JPEG_PREFIX + base64.b64encode(bytes(raw)).decode("ascii")


def _decode_jpeg(data, limit: int) -> bytes:
    if not isinstance(data, str) or not data.startswith(JPEG_PREFIX):
        fail(422, MSG_PHOTO_BAD)
    try:
        raw = base64.b64decode(data[len(JPEG_PREFIX) :], validate=True)
    except (ValueError, binascii.Error):
        fail(422, MSG_PHOTO_BAD)
    if not raw.startswith(JPEG_MAGIC):
        fail(422, MSG_PHOTO_BAD)
    if len(raw) > limit:
        fail(422, MSG_PHOTO_BIG)
    return raw


def parse_photo(photo: dict) -> tuple[bytes, bytes]:
    """{full, thumb} (data:-URL) -> байты; проверяются префикс, магические байты JPEG и лимиты размера."""
    return _decode_jpeg(photo.get("full"), FULL_LIMIT), _decode_jpeg(photo.get("thumb"), THUMB_LIMIT)


def _save_photo(session: Session, person_id: int, full: bytes, thumb: bytes) -> None:
    session.execute(
        text(
            f"""INSERT INTO {S}photos (person_id, photo_full, photo_thumb) VALUES (:p, :f, :t)
                ON CONFLICT (person_id) DO UPDATE SET photo_full = :f, photo_thumb = :t, updated_at = now()"""
        ),
        {"p": person_id, "f": full, "t": thumb},
    )


def _field(r) -> dict:
    return {
        "id": r["id"], "key": r["key"], "label": r["label"], "hint": r["hint"], "kind": r["kind"], "required": r["required"],
        "options": r["options"] or [], "sort": r["sort"], "isSystem": r["is_system"], "active": r["active"],
    }


def _fields(session: Session, only_active: bool) -> list:
    where = "WHERE active" if only_active else ""
    return session.execute(text(f"SELECT * FROM {S}form_fields {where} ORDER BY sort, id")).mappings().all()


def list_fields(session: Session, only_active: bool) -> list[dict]:
    return [_field(r) for r in _fields(session, only_active)]


PERSON_SQL = f"""SELECT p.id, p.user_id, p.email, p.first_name, p.last_name, p.title, p.manager_id, p.direction_id, p.tag, p.team,
       p.is_ceo, p.is_assistant, p.show_in_map, p.is_archived, p.answers, p.sort, u.email AS user_email,
       (SELECT count(*) FROM {S}people c WHERE c.manager_id = p.id AND NOT c.is_archived) AS reports,
       ph.person_id IS NOT NULL AS has_photo, ph.photo_thumb
       FROM {S}people p LEFT JOIN trendsetter_hub.users u ON u.id = p.user_id LEFT JOIN {S}photos ph ON ph.person_id = p.id"""


def _extra(fields, answers: dict) -> list:
    """Ответы на активные несистемные поля (в порядке sort, пустые пропускаются): новые поля HR видны в профиле без деплоя."""
    return [
        {"key": f["key"], "label": f["label"], "kind": f["kind"], "value": answers[f["key"]]}
        for f in fields
        if f["active"] and not f["is_system"] and f["kind"] != "photo" and f["key"] != "socials" and answers.get(f["key"]) not in (None, "", [])
    ]


def _pub(r, fields, *, thumb: bool = True) -> dict:
    a = r["answers"] or {}
    return {
        "id": r["id"], "name": f"{r['last_name']} {r['first_name']}".strip(), "title": r["title"], "managerId": r["manager_id"],
        "directionId": r["direction_id"], "tag": r["tag"], "isCeo": r["is_ceo"], "isAssistant": r["is_assistant"], "team": r["team"],
        "location": a.get("location"), "workFormat": a.get("work_format"), "responsibility": a.get("responsibility"),
        "askMeAbout": a.get("ask_me_about"), "hobbies": a.get("hobbies") or [], "telegram": a.get("telegram"), "email": r["email"],
        "socials": a.get("socials") or [], "thumb": _data_url(r["photo_thumb"]) if thumb else None, "extra": _extra(fields, a),
    }


def _structure(r) -> dict:
    return {
        "id": r["id"], "name": f"{r['last_name']} {r['first_name']}".strip(), "title": r["title"], "managerId": r["manager_id"],
        "directionId": r["direction_id"], "isCeo": r["is_ceo"], "isAssistant": r["is_assistant"],
    }


def _hr_person_dict(r, fields) -> dict:
    return {
        **_pub(r, fields), "firstName": r["first_name"], "lastName": r["last_name"], "userId": r["user_id"], "userEmail": r["user_email"], "showInMap": r["show_in_map"], "isArchived": r["is_archived"],
        "hasPhoto": r["has_photo"], "directReports": r["reports"], "answers": r["answers"] or {},
    }


def _person_row(session: Session, person_id: int, *, lock: bool = False):
    if lock:  # блокируем только строку карточки (FOR UPDATE с внешними соединениями недопустим)
        session.execute(text(f"SELECT 1 FROM {S}people WHERE id = :i FOR UPDATE"), {"i": person_id})
    return session.execute(text(PERSON_SQL + " WHERE p.id = :i"), {"i": person_id}).mappings().first()


def _hr_person(session: Session, person_id: int) -> dict:
    row = _person_row(session, person_id)
    if row is None:
        fail(404, MSG_PERSON_NOT_FOUND)
    return _hr_person_dict(row, _fields(session, True))


def _person_values(r) -> dict:
    """Текущие значения карточки в виде значений анкеты (ключ поля -> значение)."""
    return {"first_name": r["first_name"], "last_name": r["last_name"], "title": r["title"], "email": r["email"], **(r["answers"] or {})}


# ---------- проверка значений анкеты ----------


def _bad(label: str):
    fail(422, f"Некорректное значение поля «{label}»")


def _clean_value(f, raw):
    """Значение одного поля анкеты по его типу; пустое -> None. Нарушение лимитов — 422."""
    kind, key, label = f["kind"], f["key"], f["label"]
    if raw is None:
        return None
    if kind in ("text", "textarea", "select"):
        if not isinstance(raw, str):
            _bad(label)
        v = raw.strip()
        if key == "telegram":
            v = v.lstrip("@").strip()
        limit = {"text": 200, "textarea": 2000, "select": 80}[kind]
        if len(v) > limit:
            _bad(label)
        if v and key == "email" and not EMAIL_RE.match(v):
            fail(422, m.EMAIL_INVALID)
        return v or None
    if kind == "chips":
        if not isinstance(raw, list) or len(raw) > 20:
            _bad(label)
        out = []
        for x in raw:
            if not isinstance(x, str) or len(x.strip()) > 60:
                _bad(label)
            if x.strip():
                out.append(x.strip())
        return out or None
    if kind == "links":
        if not isinstance(raw, list) or len(raw) > 5:
            _bad(label)
        out = []
        for x in raw:
            if not isinstance(x, dict) or not isinstance(x.get("url"), str):
                _bad(label)
            url, name = x["url"].strip(), x.get("label") or ""
            if not isinstance(name, str) or len(name.strip()) > 60 or len(url) > 300 or not re.match(r"^https?://\S+$", url, re.I):
                _bad(label)
            out.append({"label": name.strip(), "url": url})
        return out or None
    _bad(label)


def _clean(fields, values: dict, *, strict: bool, has_person: bool) -> dict:
    """Значения по активным полям (кроме фото). Пустое необязательное -> None (так значение стирается при одобрении).
    strict — проверять обязательность; manager_claim обязателен только пока у человека нет карточки."""
    out = {}
    for f in fields:
        if f["kind"] == "photo" or not f["active"]:
            continue
        v = _clean_value(f, values.get(f["key"]))
        if v is None and strict and f["required"] and not (f["key"] == "manager_claim" and has_person):
            fail(422, f"Заполните поле «{f['label']}»")
        out[f["key"]] = v
    return out


def _split_values(clean: dict) -> tuple[dict, dict]:
    """(колонки карточки, answers)."""
    cols = {k: clean[k] for k in COLUMN_KEYS if k in clean}
    return cols, {k: v for k, v in clean.items() if k not in COLUMN_KEYS}


def _merge_answers(old: dict | None, patch: dict) -> dict:
    """Новые ответы поверх старых; None стирает ключ. Ответы скрытых полей не теряются."""
    merged = {**(old or {}), **patch}
    return {k: v for k, v in merged.items() if v is not None}


# ---------- карта и фото (просмотр) ----------


def get_map(session: Session, user: User, access: str) -> dict:
    where = "WHERE p.show_in_map AND NOT p.is_archived ORDER BY p.sort, p.id"
    rows = session.execute(text(PERSON_SQL + " " + where)).mappings().all()
    fields = _fields(session, True) if can_see_data(access) else []
    people = [_pub(r, fields) if can_see_data(access) else _structure(r) for r in rows]
    used = {r["direction_id"] for r in rows} | {"leadership"}
    return {"directions": [d for d in list_directions(session) if d["id"] in used], "people": people}


def list_directions(session: Session) -> list[dict]:
    """Все направления по sort (включая пустые и leadership)."""
    rows = session.execute(text(f"SELECT * FROM {S}directions ORDER BY sort, id")).mappings().all()
    return [{"id": d["id"], "label": d["label"], "shortName": d["short_name"], "color": d["color"], "avatarInk": d["avatar_ink"]} for d in rows]


def person_photo(session: Session, person_id: int, *, only_visible: bool) -> dict:
    cond = "AND p.show_in_map AND NOT p.is_archived" if only_visible else ""
    raw = session.execute(
        text(f"SELECT ph.photo_full FROM {S}photos ph JOIN {S}people p ON p.id = ph.person_id WHERE ph.person_id = :i {cond}"), {"i": person_id}
    ).scalar()
    if raw is None:
        fail(404, m.NOT_FOUND)
    return {"data": _data_url(raw)}


# ---------- анкета сотрудника ----------


def _name_words(*parts: str | None) -> frozenset:
    """Имя как множество слов: lower, ё->е, без знаков препинания (порядок слов не важен)."""
    return frozenset(re.findall(r"\w+", " ".join(p for p in parts if p).lower().replace("ё", "е")))


def resolve_own_person(session: Session, user: User) -> int | None:
    """Карточка пользователя: по user_id, затем по почте, затем по имени (ровно одна свободная неархивная карточка). Ничего не пишет."""
    pid = session.execute(text(f"SELECT id FROM {S}people WHERE user_id = :u"), {"u": user.id}).scalar()
    if pid is None and user.email:
        pid = session.execute(
            text(f"SELECT id FROM {S}people WHERE lower(email) = lower(:e) AND user_id IS NULL AND NOT is_archived ORDER BY id LIMIT 1"),
            {"e": user.email},
        ).scalar()
    if pid is None:
        words = _name_words(user.full_name)
        if words:
            rows = session.execute(text(f"SELECT id, first_name, last_name FROM {S}people WHERE user_id IS NULL AND NOT is_archived")).mappings().all()
            found = [r["id"] for r in rows if _name_words(r["last_name"], r["first_name"]) == words]
            if len(found) == 1:
                pid = found[0]
    return pid


def _pending(session: Session, user_id: int, *, lock: bool = False):
    suffix = " FOR UPDATE" if lock else ""
    return session.execute(
        text(f"""SELECT id, person_id, "values", photo_full IS NOT NULL AS has_photo, photo_full FROM {S}submissions WHERE user_id = :u AND status = 'pending'{suffix}"""),
        {"u": user_id},
    ).mappings().first()


def get_me(session: Session, user: User) -> dict:
    pid = resolve_own_person(session, user)
    row = _person_row(session, pid) if pid else None
    pending = _pending(session, user.id)
    last = session.execute(
        text(f"""SELECT id, status, review_comment, created_at, "values", photo_full FROM {S}submissions WHERE user_id = :u ORDER BY id DESC LIMIT 1"""), {"u": user.id}
    ).mappings().first()
    values = _person_values(row) if row else {}
    if row is None:  # новый человек: имя из учётки, только если оно ровно из двух слов («Имя Фамилия»)
        parts = (user.full_name or "").split()
        if len(parts) == 2:
            values["first_name"], values["last_name"] = parts
    if not values.get("email"):
        values["email"] = user.email
    if pending:
        values = {**values, **(pending["values"] or {})}
    photo = pending["photo_full"] if pending and pending["photo_full"] is not None else None
    if pending is None and last and last["status"] == "rejected":  # отклонённая заявка — основа для исправления
        values = {**values, **(last["values"] or {})}
        photo = last["photo_full"]
    if photo is None and pid:
        photo = session.execute(text(f"SELECT photo_full FROM {S}photos WHERE person_id = :p"), {"p": pid}).scalar()
    person = None
    if row:
        person = {**_pub(row, _fields(session, True)), "firstName": row["first_name"], "lastName": row["last_name"], "showInMap": row["show_in_map"], "isArchived": row["is_archived"], "hasPhoto": row["has_photo"]}
    return {
        "person": person,
        "values": values,
        "submission": (
            {"id": last["id"], "status": last["status"], "reviewComment": last["review_comment"], "createdAt": last["created_at"].isoformat()}
            if last
            else None
        ),
        "photo": _data_url(photo),
    }


def submit(session: Session, user: User, values: dict, photo: dict | None, *, replace: bool) -> dict:
    """Новая заявка (replace=False) или замена своей pending (replace=True). Любая правка сотрудника — только через заявку."""
    pid = resolve_own_person(session, user)
    pending = _pending(session, user.id, lock=True)
    if replace and pending is None:
        fail(404, MSG_NO_PENDING)
    if not replace and pending is not None:
        fail(409, MSG_PENDING_EXISTS)
    clean = _clean(_fields(session, True), values or {}, strict=True, has_person=pid is not None)
    full = thumb = None
    if photo is not None:
        full, thumb = parse_photo(photo)
    elif not replace:  # фото из последней отклонённой заявки не нужно загружать повторно
        last = session.execute(
            text(f"SELECT status, photo_full, photo_thumb FROM {S}submissions WHERE user_id = :u ORDER BY id DESC LIMIT 1"), {"u": user.id}
        ).mappings().first()
        if last and last["status"] == "rejected" and last["photo_full"] is not None:
            full, thumb = bytes(last["photo_full"]), bytes(last["photo_thumb"])
    has_photo = (
        full is not None
        or (pending is not None and pending["has_photo"])
        or (pid is not None and session.execute(text(f"SELECT 1 FROM {S}photos WHERE person_id = :p"), {"p": pid}).first() is not None)
    )
    if not has_photo:
        fail(422, MSG_PHOTO_REQUIRED)
    try:
        if replace:
            session.execute(
                text(
                    f"""UPDATE {S}submissions SET "values" = CAST(:v AS jsonb), person_id = :p, photo_full = COALESCE(:f, photo_full),
                        photo_thumb = COALESCE(:t, photo_thumb) WHERE id = :i"""
                ),
                {"v": json.dumps(clean, ensure_ascii=False), "p": pid, "f": full, "t": thumb, "i": pending["id"]},
            )
            sid = pending["id"]
        else:
            sid = session.execute(
                text(
                    f"""INSERT INTO {S}submissions (user_id, person_id, status, "values", photo_full, photo_thumb)
                        VALUES (:u, :p, 'pending', CAST(:v AS jsonb), :f, :t) RETURNING id"""
                ),
                {"u": user.id, "p": pid, "v": json.dumps(clean, ensure_ascii=False), "f": full, "t": thumb},
            ).scalar_one()
        if pid is not None:  # связь «учётка — карточка» запоминается при первой заявке
            bound = session.execute(text(f"UPDATE {S}people SET user_id = :u WHERE id = :p AND user_id IS NULL"), {"u": user.id, "p": pid}).rowcount
            if not bound and session.execute(text(f"SELECT user_id FROM {S}people WHERE id = :p"), {"p": pid}).scalar() != user.id:
                session.rollback()  # карточку успел занять другой пользователь
                fail(409, MSG_USER_LINKED)
        log_action(session, user.id, "team.submit", MODULE_ID, submission_id=sid, person_id=pid, replace=replace, fields=sorted(clean))
        session.commit()
    except IntegrityError:
        session.rollback()
        fail(409, MSG_PENDING_EXISTS)
    return {"id": sid, "status": "pending"}


def cancel_submission(session: Session, user: User) -> dict:
    sid = session.execute(
        text(f"DELETE FROM {S}submissions WHERE user_id = :u AND status = 'pending' RETURNING id"), {"u": user.id}
    ).scalar()
    if sid is None:
        fail(404, MSG_NO_PENDING)
    log_action(session, user.id, "team.cancel", MODULE_ID, submission_id=sid)
    session.commit()
    return {"ok": True}


# ---------- HR: заявки ----------


def pending_count(session: Session) -> dict:
    return {"count": session.execute(text(f"SELECT count(*) FROM {S}submissions WHERE status = 'pending'")).scalar_one()}


def list_submissions(session: Session, status: str) -> list[dict]:
    if status not in ("pending", "approved", "rejected", "all"):
        fail(422, m.INVALID)
    cond = "" if status == "all" else "WHERE s.status = :st"
    order = "s.created_at, s.id" if status == "pending" else "s.id DESC"
    rows = session.execute(
        text(
            f"""SELECT s.id, s.user_id, u.full_name, u.email, s.person_id, s.status, s.created_at, s.reviewed_at, s.review_comment,
                s."values", s.photo_full IS NOT NULL AS has_photo, s.photo_thumb
                FROM {S}submissions s JOIN trendsetter_hub.users u ON u.id = s.user_id {cond} ORDER BY {order}"""
        ),
        {"st": status},
    ).mappings().all()
    out = []
    for r in rows:
        current = None
        if r["person_id"]:
            person = _person_row(session, r["person_id"])
            current = _person_values(person) if person else None
        out.append(
            {
                "id": r["id"], "userId": r["user_id"], "userName": r["full_name"], "userEmail": r["email"], "personId": r["person_id"],
                "status": r["status"], "createdAt": r["created_at"].isoformat(),
                "reviewedAt": r["reviewed_at"].isoformat() if r["reviewed_at"] else None, "reviewComment": r["review_comment"],
                "values": r["values"] or {}, "hasPhoto": r["has_photo"], "thumb": _data_url(r["photo_thumb"]), "current": current,
            }
        )
    return out


def submission_photo(session: Session, submission_id: int) -> dict:
    raw = session.execute(text(f"SELECT photo_full FROM {S}submissions WHERE id = :i"), {"i": submission_id}).scalar()
    if raw is None:
        fail(404, m.NOT_FOUND)
    return {"data": _data_url(raw)}


def _would_cycle(session: Session, person_id: int, manager_id: int) -> bool:
    """True, если manager_id — сам человек или его подчинённый (поднимаемся от нового руководителя к корню)."""
    seen, cur = set(), manager_id
    while cur is not None:
        if cur == person_id or cur in seen:
            return True
        seen.add(cur)
        cur = session.execute(text(f"SELECT manager_id FROM {S}people WHERE id = :i"), {"i": cur}).scalar()
    return False


def _org_cols(session: Session, row, d: dict) -> dict:
    """Колонки, которые меняет только HR: руководитель, направление, тег, команда, «показывать в карте». row=None — новая карточка."""
    cols = {}
    if "managerId" in d and (row is None or d["managerId"] != row["manager_id"]):
        mid = d["managerId"]
        if row is not None and row["is_ceo"]:
            fail(422, MSG_CEO_MANAGER)
        if mid is None:
            fail(422, MSG_MANAGER_REQUIRED)
        if session.execute(text(f"SELECT 1 FROM {S}people WHERE id = :i"), {"i": mid}).first() is None:
            fail(422, MSG_MANAGER_NOT_FOUND)
        if row is not None and _would_cycle(session, row["id"], mid):
            fail(422, MSG_CYCLE)
        cols["manager_id"] = mid
    if "directionId" in d:
        if d["directionId"] is None or session.execute(text(f"SELECT 1 FROM {S}directions WHERE id = :i"), {"i": d["directionId"]}).first() is None:
            fail(422, MSG_DIRECTION_NOT_FOUND)
        cols["direction_id"] = d["directionId"]
    for key, col, limit in (("tag", "tag", 60), ("team", "team", 120)):
        if key in d:
            v = d[key]
            if v is not None and (not isinstance(v, str) or len(v.strip()) > limit):
                fail(422, m.INVALID)
            cols[col] = (v or "").strip() or None
    if "showInMap" in d and d["showInMap"] is not None:
        cols["show_in_map"] = bool(d["showInMap"])
    return cols


def _update_row(session: Session, person_id: int, cols: dict, answers_patch: dict | None, old_answers: dict | None) -> None:
    sets = dict(cols)
    if answers_patch:
        sets["answers"] = json.dumps(_merge_answers(old_answers, answers_patch), ensure_ascii=False)
    placeholders = [f"{c} = CAST(:{c} AS jsonb)" if c == "answers" else f"{c} = :{c}" for c in sets]
    session.execute(text(f"UPDATE {S}people SET {', '.join(placeholders + ['updated_at = now()'])} WHERE id = :_id"), {**sets, "_id": person_id})


def approve(session: Session, hr: User, submission_id: int, d: dict) -> dict:
    sub = session.execute(
        text(f"""SELECT * FROM {S}submissions WHERE id = :i FOR UPDATE"""), {"i": submission_id}
    ).mappings().first()
    if sub is None:
        fail(404, MSG_SUBMISSION_NOT_FOUND)
    if sub["status"] != "pending":
        fail(409, MSG_NOT_PENDING)
    values = sub["values"] or {}
    pid = sub["person_id"]
    if pid is None:
        pid = session.execute(text(f"SELECT id FROM {S}people WHERE user_id = :u"), {"u": sub["user_id"]}).scalar()
    if pid is None and d.get("personId") is None:
        owner = session.get(User, sub["user_id"])
        pid = resolve_own_person(session, owner) if owner else None
    if pid is None and d.get("personId") is not None:
        pid = d["personId"]
        other = session.execute(text(f"SELECT user_id FROM {S}people WHERE id = :i"), {"i": pid}).mappings().first()
        if other is None:
            fail(404, MSG_PERSON_NOT_FOUND)
        if other["user_id"] is not None and other["user_id"] != sub["user_id"]:
            fail(409, MSG_USER_LINKED)
    cols, answers = _split_values(values)
    try:
        if pid is None:
            if d.get("directionId") is None:
                fail(422, MSG_DIRECTION_REQUIRED)
            if d.get("managerId") is None:
                fail(422, MSG_MANAGER_REQUIRED)
            org = _org_cols(session, None, d)
            for k in ("first_name", "last_name", "title"):
                if not cols.get(k):
                    fail(422, m.INVALID)
            pid = session.execute(
                text(
                    f"""INSERT INTO {S}people (user_id, email, first_name, last_name, title, manager_id, direction_id, tag, team, show_in_map, answers, sort)
                        VALUES (:u, :email, :fn, :ln, :t, :mgr, :dir, :tag, :team, :show, CAST(:a AS jsonb),
                                (SELECT COALESCE(max(sort), 0) + 1 FROM {S}people)) RETURNING id"""
                ),
                {
                    "u": sub["user_id"], "email": cols.get("email"), "fn": cols["first_name"], "ln": cols["last_name"], "t": cols["title"],
                    "mgr": org["manager_id"], "dir": org["direction_id"], "tag": org.get("tag"), "team": org.get("team"),
                    "show": org.get("show_in_map", True), "a": json.dumps(_merge_answers({}, answers), ensure_ascii=False),
                },
            ).scalar_one()
        else:
            row = _person_row(session, pid, lock=True)
            if row is None:
                fail(404, MSG_PERSON_NOT_FOUND)
            if row["user_id"] not in (None, sub["user_id"]):
                fail(409, MSG_USER_LINKED)
            org = _org_cols(session, row, d)
            _update_row(session, pid, {**cols, **org, "user_id": sub["user_id"]}, answers, row["answers"])
        if sub["photo_full"] is not None:
            _save_photo(session, pid, bytes(sub["photo_full"]), bytes(sub["photo_thumb"]))
        session.execute(
            text(f"UPDATE {S}submissions SET status = 'approved', person_id = :p, reviewed_by = :r, reviewed_at = now() WHERE id = :i"),
            {"p": pid, "r": hr.id, "i": submission_id},
        )
        log_action(session, hr.id, "team.approve", MODULE_ID, submission_id=submission_id, person_id=pid)
        session.commit()
    except IntegrityError:
        session.rollback()
        fail(409, MSG_EMAIL_DUPLICATE)
    return _hr_person(session, pid)


def reject(session: Session, hr: User, submission_id: int, comment: str) -> dict:
    comment = (comment or "").strip()
    if not 1 <= len(comment) <= 500:
        fail(422, MSG_COMMENT)
    status = session.execute(text(f"SELECT status FROM {S}submissions WHERE id = :i FOR UPDATE"), {"i": submission_id}).scalar()
    if status is None:
        fail(404, MSG_SUBMISSION_NOT_FOUND)
    if status != "pending":
        fail(409, MSG_NOT_PENDING)
    session.execute(
        text(f"UPDATE {S}submissions SET status = 'rejected', review_comment = :c, reviewed_by = :r, reviewed_at = now() WHERE id = :i"),
        {"c": comment, "r": hr.id, "i": submission_id},
    )
    log_action(session, hr.id, "team.reject", MODULE_ID, submission_id=submission_id)
    session.commit()
    return {"ok": True}


# ---------- HR: люди ----------


def hr_people(session: Session) -> list[dict]:
    fields = _fields(session, True)
    return [_hr_person_dict(r, fields) for r in session.execute(text(PERSON_SQL + " ORDER BY p.sort, p.id")).mappings().all()]


def hr_users(session: Session) -> list[dict]:
    rows = session.execute(
        text(
            f"""SELECT u.id, u.full_name, u.email,
                (SELECT p.id FROM {S}people p WHERE p.user_id = u.id
                    OR (p.user_id IS NULL AND lower(p.email) = lower(u.email)) ORDER BY (p.user_id IS NULL), p.id LIMIT 1) AS person_id
                FROM trendsetter_hub.users u WHERE u.is_active ORDER BY u.full_name, u.id"""
        )
    ).mappings().all()
    return [{"id": r["id"], "fullName": r["full_name"], "email": r["email"], "personId": r["person_id"]} for r in rows]


def _req_text(d: dict, key: str, limit: int) -> str:
    v = d.get(key)
    if not isinstance(v, str) or not v.strip() or len(v.strip()) > limit:
        fail(422, m.INVALID)
    return v.strip()


def _opt_email(v) -> str | None:
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    if not isinstance(v, str) or not EMAIL_RE.match(v.strip()) or len(v.strip()) > 120:
        fail(422, m.EMAIL_INVALID)
    return v.strip()


def _check_user(session: Session, user_id: int, person_id: int | None) -> None:
    if session.execute(text("SELECT 1 FROM trendsetter_hub.users WHERE id = :i"), {"i": user_id}).first() is None:
        fail(422, m.USER_NOT_FOUND)
    other = session.execute(text(f"SELECT id FROM {S}people WHERE user_id = :u"), {"u": user_id}).scalar()
    if other is not None and other != person_id:
        fail(409, MSG_USER_LINKED)


def _hr_values(session: Session, d: dict) -> dict:
    """Значения анкеты, введённые HR (обязательность не проверяется); колонки карточки задаются отдельными полями."""
    given = d.get("values") or {}
    clean = _clean(_fields(session, True), given, strict=False, has_person=True)
    return {k: v for k, v in clean.items() if k not in COLUMN_KEYS and k in given}  # поля, которых нет в запросе, не затираются


def create_person(session: Session, hr: User, d: dict) -> dict:
    first, last, title = _req_text(d, "firstName", 80), _req_text(d, "lastName", 80), _req_text(d, "title", 200)
    if d.get("directionId") is None:
        fail(422, MSG_DIRECTION_REQUIRED)
    if d.get("managerId") is None:  # TODO(Q-T4): CEO через API не создаётся (нет isCeo в контракте), руководитель обязателен всегда
        fail(422, MSG_MANAGER_REQUIRED)
    org = _org_cols(session, None, d)
    email = _opt_email(d.get("email"))
    if d.get("userId") is not None:
        _check_user(session, d["userId"], None)
    answers = _merge_answers({}, _hr_values(session, d))
    photo = parse_photo(d["photo"]) if d.get("photo") else None
    try:
        pid = session.execute(
            text(
                f"""INSERT INTO {S}people (user_id, email, first_name, last_name, title, manager_id, direction_id, tag, team, show_in_map, answers, sort)
                    VALUES (:u, :email, :fn, :ln, :t, :mgr, :dir, :tag, :team, :show, CAST(:a AS jsonb),
                            (SELECT COALESCE(max(sort), 0) + 1 FROM {S}people)) RETURNING id"""
            ),
            {
                "u": d.get("userId"), "email": email, "fn": first, "ln": last, "t": title, "mgr": org["manager_id"], "dir": org["direction_id"],
                "tag": org.get("tag"), "team": org.get("team"), "show": org.get("show_in_map", True), "a": json.dumps(answers, ensure_ascii=False),
            },
        ).scalar_one()
        if photo:
            _save_photo(session, pid, *photo)
        log_action(session, hr.id, "team.person_create", MODULE_ID, person_id=pid)
        session.commit()
    except IntegrityError:
        session.rollback()
        fail(409, MSG_EMAIL_DUPLICATE)
    return _hr_person(session, pid)


def update_person(session: Session, hr: User, person_id: int, d: dict) -> dict:
    row = _person_row(session, person_id, lock=True)
    if row is None:
        fail(404, MSG_PERSON_NOT_FOUND)
    cols = _org_cols(session, row, d)
    for key, col, limit in (("firstName", "first_name", 80), ("lastName", "last_name", 80), ("title", "title", 200)):
        if key in d:
            cols[col] = _req_text(d, key, limit)
    if "email" in d:
        cols["email"] = _opt_email(d["email"])
    if "userId" in d:
        if d["userId"] is not None:
            _check_user(session, d["userId"], person_id)
        cols["user_id"] = d["userId"]
    if "sort" in d and d["sort"] is not None:
        cols["sort"] = d["sort"]
    answers_patch = _hr_values(session, d) if d.get("values") else None
    photo = parse_photo(d["photo"]) if d.get("photo") else None
    archived_now = False
    try:
        if "isArchived" in d and d["isArchived"] is not None and d["isArchived"] != row["is_archived"]:
            if d["isArchived"]:
                if row["is_ceo"]:
                    fail(422, MSG_CEO_ARCHIVE)
                if _active_reports(session, person_id):
                    target = d.get("reassignTo")
                    if target is None:
                        fail(409, MSG_REASSIGN)
                    trow = _person_row(session, target) if isinstance(target, int) else None
                    if trow is None or trow["is_archived"] or target == person_id:
                        fail(422, MSG_MANAGER_NOT_FOUND)
                    if _would_cycle(session, person_id, target):
                        fail(422, MSG_CYCLE)
                    session.execute(
                        text(f"UPDATE {S}people SET manager_id = :t, updated_at = now() WHERE manager_id = :p AND NOT is_archived"),
                        {"t": target, "p": person_id},
                    )
                archived_now = True
            cols["is_archived"] = d["isArchived"]
        if cols or answers_patch:
            _update_row(session, person_id, cols, answers_patch, row["answers"])
        if photo:
            _save_photo(session, person_id, *photo)
        log_action(
            session, hr.id, "team.person_archive" if archived_now else "team.person_update", MODULE_ID,
            person_id=person_id, fields=sorted(d), **({"reassign_to": d.get("reassignTo")} if archived_now else {}),
        )
        session.commit()
    except IntegrityError:
        session.rollback()
        fail(409, MSG_EMAIL_DUPLICATE)
    return _hr_person(session, person_id)


def _active_reports(session: Session, person_id: int) -> bool:
    return session.execute(text(f"SELECT 1 FROM {S}people WHERE manager_id = :p AND NOT is_archived LIMIT 1"), {"p": person_id}).first() is not None


# ---------- HR: конструктор полей ----------


def _clean_options(options) -> list:
    if options is None:
        return []
    if not isinstance(options, list) or len(options) > 50:
        fail(422, m.INVALID)
    out = []
    for o in options:
        if not isinstance(o, str) or not o.strip() or len(o.strip()) > 80:
            fail(422, m.INVALID)
        out.append(o.strip())
    return out


def _opt_str(v, limit: int) -> str | None:
    if v is None:
        return None
    if not isinstance(v, str) or len(v.strip()) > limit:
        fail(422, m.INVALID)
    return v.strip() or None


def _field_row(session: Session, field_id: int, *, lock: bool = False):
    row = session.execute(text(f"SELECT * FROM {S}form_fields WHERE id = :i{' FOR UPDATE' if lock else ''}"), {"i": field_id}).mappings().first()
    if row is None:
        fail(404, MSG_FIELD_NOT_FOUND)
    return row


def create_field(session: Session, hr: User, d: dict) -> dict:
    key = d.get("key")
    if not isinstance(key, str) or not KEY_RE.match(key):
        fail(422, MSG_KEY_INVALID)
    label = _opt_str(d.get("label"), 80)
    if not label:
        fail(422, m.INVALID)
    kind = d.get("kind")
    if kind not in KINDS:
        fail(422, m.INVALID)
    if kind == "photo":
        fail(422, MSG_PHOTO_FIELD)
    options = _clean_options(d.get("options")) if kind == "select" else []
    try:
        fid = session.execute(
            text(
                f"""INSERT INTO {S}form_fields (key, label, hint, kind, required, options, sort)
                    VALUES (:k, :l, :h, :kind, :r, CAST(:o AS jsonb), (SELECT COALESCE(max(sort), 0) + 10 FROM {S}form_fields)) RETURNING id"""
            ),
            {"k": key, "l": label, "h": _opt_str(d.get("hint"), 200), "kind": kind, "r": bool(d.get("required")), "o": json.dumps(options, ensure_ascii=False)},
        ).scalar_one()
        log_action(session, hr.id, "team.field_create", MODULE_ID, field_id=fid, key=key)
        session.commit()
    except IntegrityError:
        session.rollback()
        fail(409, MSG_FIELD_DUPLICATE)
    return _field(_field_row(session, fid))


def update_field(session: Session, hr: User, field_id: int, d: dict) -> dict:
    row = _field_row(session, field_id, lock=True)
    sets = {}
    if "label" in d:
        label = _opt_str(d["label"], 80)
        if not label:
            fail(422, m.INVALID)
        sets["label"] = label
    if "hint" in d:
        sets["hint"] = _opt_str(d["hint"], 200)
    if "required" in d and d["required"] is not None:
        sets["required"] = bool(d["required"])
    if "options" in d:
        sets["options"] = json.dumps(_clean_options(d["options"]), ensure_ascii=False)
    if "sort" in d and d["sort"] is not None:
        sets["sort"] = d["sort"]
    if "active" in d and d["active"] is not None:
        if row["is_system"] and not d["active"]:
            fail(422, MSG_SYSTEM_HIDE)
        sets["active"] = bool(d["active"])
    if sets:
        placeholders = [f"{c} = CAST(:{c} AS jsonb)" if c == "options" else f"{c} = :{c}" for c in sets]
        session.execute(text(f"UPDATE {S}form_fields SET {', '.join(placeholders)} WHERE id = :_id"), {**sets, "_id": field_id})
        log_action(session, hr.id, "team.field_update", MODULE_ID, field_id=field_id, fields=sorted(d))
        session.commit()
    return _field(_field_row(session, field_id))


def reorder_fields(session: Session, hr: User, ids: list[int]) -> list[dict]:
    """Перечисленные поля идут первыми в заданном порядке, остальные — после них в прежнем порядке."""
    existing = [r["id"] for r in _fields(session, False)]
    if len(set(ids)) != len(ids) or not set(ids) <= set(existing):
        fail(422, m.INVALID)
    order = list(ids) + [i for i in existing if i not in set(ids)]
    for pos, fid in enumerate(order, start=1):
        session.execute(text(f"UPDATE {S}form_fields SET sort = :s WHERE id = :i"), {"s": pos * 10, "i": fid})
    log_action(session, hr.id, "team.field_update", MODULE_ID, reorder=list(ids))
    session.commit()
    return list_fields(session, False)
