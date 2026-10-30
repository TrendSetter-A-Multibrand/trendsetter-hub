"""Модуль «Обратная связь»: благодарность, предложение, жалоба, в том числе анонимная (docs/TZ-feedback.md).

Таблица feedback_messages (db/18_feedback.sql). Текст и внутренний комментарий хранятся только зашифрованными (app.core.crypto).
У анонимных сообщений автор не хранится нигде: ни в таблице, ни в audit_log, ни в уведомлениях, ни в логах. Единственное
использование user.id в анонимной ветке — ключ лимитера (HMAC с солью, живущей только в памяти процесса).
Читатель — «Ответственный» на feedback или admin; module_access (view/run) читателем не делает.
В журнал (module_id='feedback') пишутся только id, kind, status и имена изменённых полей; тексты, комментарии и имена не пишутся.
"""
import hmac
import logging
import secrets
import threading
import time
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core import crypto
from app.core import messages as m
from app.core.access import can_manage_users, can_see_data
from app.core.audit import log_action
from app.core.deps import module_rights
from app.core.models import User
from app.core.notifications import notify

MODULE_ID = "feedback"
F = "trendsetter_hub.feedback_messages"
U = "trendsetter_hub.users"
NOTIFY_TITLE = "Новое сообщение обратной связи"
NOTIFY_LINK = "/modules/feedback"
MINE_LIMIT = 50

MSG_CONTACT_ANON = "Связаться можно только с неанонимным автором"
MSG_RECIPIENT_KIND = "Адресата можно выбрать только для благодарности"
MSG_RECIPIENT = "Сотрудник не найден"
MSG_TOO_MANY = "Не больше 10 сообщений в сутки — попробуйте завтра"
MSG_AUTHOR_DELETED = "Сотрудник удалён"
MSG_EMPTY_PATCH = "Укажите статус или комментарий"

_crypto_log = logging.getLogger("app.feedback.crypto")

# ---------- лимит отправок (только в памяти, без следов автора) ----------

WINDOW_SECONDS = 86400
DAILY_LIMIT = 10  # TODO(Q-FB4): при нескольких воркерах uvicorn лимит станет «на воркер»
_SALT = secrets.token_bytes(32)  # создаётся при импорте, нигде не хранится и не логируется; при рестарте меняется
_limits: dict[str, list[float]] = {}
_lock = threading.Lock()


def _monotonic() -> float:
    """Текущее монотонное время. Подменяется в тестах."""
    return time.monotonic()


def _limit_key(user_id: int) -> str:
    return hmac.new(_SALT, str(user_id).encode(), "sha256").hexdigest()


def _reserve_slot(user_id: int) -> float:
    """Проверка и резерв слота под одним замком; возвращает отметку для _release_slot. Превышение — 429."""
    key = _limit_key(user_id)
    now = _monotonic()
    with _lock:
        for k in list(_limits):
            fresh = [t for t in _limits[k] if now - t < WINDOW_SECONDS]
            if fresh:
                _limits[k] = fresh
            else:
                del _limits[k]
        stamps = _limits.setdefault(key, [])
        if len(stamps) >= DAILY_LIMIT:
            raise HTTPException(429, MSG_TOO_MANY)
        stamps.append(now)
    return now


def _release_slot(user_id: int, stamp: float) -> None:
    key = _limit_key(user_id)
    with _lock:
        stamps = _limits.get(key)
        if stamps and stamp in stamps:
            stamps.remove(stamp)
            if not stamps:
                del _limits[key]


def reset_limits() -> None:
    with _lock:
        _limits.clear()


# ---------- шифрование ----------


def _protect(value: str) -> str:
    """Текст перед записью в БД. Без ключа — 503: открытым текстом не пишем никогда."""
    try:
        return crypto.encrypt_text(value)
    except crypto.KeyMissing:
        raise HTTPException(503, m.ENCRYPTION_NOT_CONFIGURED) from None


def _reveal(value: str | None) -> str | None:
    if value is None or not crypto.is_encrypted_text(value):
        return value
    try:
        return crypto.decrypt_text(value)
    except crypto.KeyMissing:
        raise HTTPException(503, m.ENCRYPTION_NOT_CONFIGURED) from None
    except crypto.DecryptError:
        _crypto_log.error("Не удалось расшифровать поле: %s", crypto.DecryptError.__name__)  # только тип ошибки
        raise HTTPException(500, m.DECRYPT_FAILED) from None


# ---------- права ----------


def access_of(session: Session, user: User) -> str:
    return module_rights(session, user, [MODULE_ID])[MODULE_ID][0]


def can_send(access: str) -> bool:
    """Отправитель: view/run (for_all даёт view всем активным, кроме viewer: у него structure)."""
    return can_see_data(access)


# TODO(Q-FB3): superuser без явного права не читатель
def is_reader(session: Session, user: User) -> bool:
    """Читатель: responsible (личное или групповое) или admin. module_access не используется."""
    return module_rights(session, user, [MODULE_ID])[MODULE_ID][1] or can_manage_users(
        access_level=user.access_level, is_active=user.is_active
    )


def reader_ids(session: Session) -> list[int]:
    """Активные пользователи с responsible на feedback (личное право или группа) плюс активные admin."""
    rows = session.execute(
        text(
            f"SELECT u.id FROM {U} u WHERE u.is_active AND NOT u.onboarding AND u.access_level IS NOT NULL AND ("
            "u.access_level = 'admin' "
            "OR EXISTS (SELECT 1 FROM trendsetter_hub.user_module_permissions p "
            "WHERE p.user_id = u.id AND p.module_id = :mid AND p.permission = 'responsible') "
            "OR EXISTS (SELECT 1 FROM trendsetter_hub.access_group_members gm "
            "JOIN trendsetter_hub.access_group_permissions gp ON gp.group_id = gm.group_id "
            "WHERE gm.user_id = u.id AND gp.module_id = :mid AND gp.permission = 'responsible')) ORDER BY u.id"
        ),
        {"mid": MODULE_ID},
    )
    return [r[0] for r in rows]


def badge(session: Session, user: User) -> int:
    """Бейдж пункта меню: число новых сообщений (только читателю)."""
    if not is_reader(session, user):
        return 0
    return session.execute(text(f"SELECT count(*) FROM {F} WHERE status = 'new'")).scalar_one()


# ---------- представление ----------


def _iso(value: datetime | None) -> str | None:
    return value.astimezone(timezone.utc).isoformat() if value is not None else None


def _mine_item(row) -> dict:
    return {
        "id": row["id"],
        "kind": row["kind"],
        "body": _reveal(row["body"]),
        "recipientName": row["recipient_name"],
        "contactOk": row["contact_ok"],
        "status": row["status"],
        "createdAt": _iso(row["created_at"]),
    }


def _reader_item(row) -> dict:
    if row["is_anonymous"]:
        author = None
    else:
        author = row["author_name"] if row["author_id"] is not None else MSG_AUTHOR_DELETED
    return {
        "id": row["id"],
        "kind": row["kind"],
        "body": _reveal(row["body"]),
        "anonymous": row["is_anonymous"],
        "authorName": author,
        "contactOk": row["contact_ok"],
        "recipientName": row["recipient_name"],
        "status": row["status"],
        "note": _reveal(row["note"]),
        "createdAt": _iso(row["created_at"]),
        "updatedAt": _iso(row["updated_at"]),
        "updatedByName": row["updated_by_name"],
    }


SELECT_ROW = (
    f"SELECT f.*, a.full_name AS author_name, r.full_name AS recipient_name, ub.full_name AS updated_by_name FROM {F} f "
    f"LEFT JOIN {U} a ON a.id = f.author_id LEFT JOIN {U} r ON r.id = f.recipient_id LEFT JOIN {U} ub ON ub.id = f.updated_by "
)


# ---------- отправитель ----------


def people(session: Session, user: User) -> list[dict]:
    rows = session.execute(
        text(f"SELECT id, full_name FROM {U} WHERE is_active AND access_level IS NOT NULL AND NOT onboarding AND id <> :me ORDER BY full_name, id"),
        {"me": user.id},
    )
    return [{"id": r[0], "fullName": r[1]} for r in rows]


def create_message(session: Session, user: User, kind: str, body: str, anonymous: bool, contact_ok: bool, recipient_id: int | None) -> dict:
    if anonymous and contact_ok:
        raise HTTPException(422, MSG_CONTACT_ANON)
    if recipient_id is not None:
        if kind != "thanks":
            raise HTTPException(422, MSG_RECIPIENT_KIND)
        found = session.execute(
            text(f"SELECT 1 FROM {U} WHERE id = :id AND id <> :me AND is_active AND access_level IS NOT NULL AND NOT onboarding"),
            {"id": recipient_id, "me": user.id},
        ).first()
        if found is None:
            raise HTTPException(422, MSG_RECIPIENT)
    stored = _protect(body)  # 503 без ключа — до резерва слота и записи
    author_id = None if anonymous else user.id
    stamp = _reserve_slot(user.id)  # единственное использование user.id в анонимной ветке: ключ лимитера (HMAC)
    try:
        new_id = session.execute(
            text(
                f"INSERT INTO {F} (kind, body, is_anonymous, author_id, contact_ok, recipient_id) "
                "VALUES (:kind, :body, :anon, :author, :contact, :recipient) RETURNING id"
            ),
            {"kind": kind, "body": stored, "anon": anonymous, "author": author_id, "contact": contact_ok, "recipient": recipient_id},
        ).scalar_one()
        if not anonymous:
            log_action(session, user.id, "feedback.create", MODULE_ID, id=new_id, kind=kind)
        notify(session, reader_ids(session), "feedback.new", NOTIFY_TITLE, "", NOTIFY_LINK)  # всем читателям, включая автора-читателя
        session.commit()
    except Exception:
        session.rollback()
        _release_slot(user.id, stamp)
        raise
    if anonymous:
        return {"ok": True}
    row = session.execute(text(SELECT_ROW + "WHERE f.id = :id"), {"id": new_id}).mappings().one()
    return _mine_item(row)


def my_messages(session: Session, user: User) -> dict:
    rows = session.execute(
        text(SELECT_ROW + "WHERE f.author_id = :me ORDER BY f.id DESC LIMIT :n"), {"me": user.id, "n": MINE_LIMIT}
    ).mappings()
    return {"items": [_mine_item(r) for r in rows]}


# ---------- читатель ----------


def list_messages(session: Session, status: str, kind: str | None, limit: int, offset: int) -> dict:
    kind_sql = " AND f.kind = :kind" if kind else ""
    params = {"status": status, "limit": limit, "offset": offset}
    if kind:
        params["kind"] = kind
    rows = session.execute(
        text(SELECT_ROW + f"WHERE f.status = :status{kind_sql} ORDER BY f.id DESC LIMIT :limit OFFSET :offset"), params
    ).mappings()
    items = [_reader_item(r) for r in rows]
    counts = {"new": 0, "in_progress": 0, "closed": 0}
    for st, n in session.execute(
        text(f"SELECT f.status, count(*) FROM {F} f WHERE true{kind_sql} GROUP BY f.status"), {"kind": kind} if kind else {}
    ):
        counts[st] = n
    return {"items": items, "total": counts[status], "counts": counts}


def update_message(session: Session, user: User, message_id: int, data: dict) -> dict:
    if not data:
        raise HTTPException(422, MSG_EMPTY_PATCH)
    exists = session.execute(text(f"SELECT 1 FROM {F} WHERE id = :id FOR UPDATE"), {"id": message_id}).first()
    if exists is None:
        raise HTTPException(404, m.NOT_FOUND)
    sets = ["updated_at = now()", "updated_by = :uid"]
    params: dict = {"id": message_id, "uid": user.id}
    if "status" in data:
        sets.append("status = :status")
        params["status"] = data["status"]
    if "note" in data:
        note = (data["note"] or "").strip()
        sets.append("note = :note")
        params["note"] = _protect(note) if note else None
    session.execute(text(f"UPDATE {F} SET {', '.join(sets)} WHERE id = :id"), params)
    details: dict = {"id": message_id, "fields": sorted(data)}
    if "status" in data:
        details["status"] = data["status"]
    log_action(session, user.id, "feedback.update", MODULE_ID, **details)
    session.commit()
    row = session.execute(text(SELECT_ROW + "WHERE f.id = :id"), {"id": message_id}).mappings().one()
    return _reader_item(row)
