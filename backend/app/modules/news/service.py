"""Модуль «Новости компании»: новости и события, ответы «Кто пойдёт», срочная плашка.

Таблицы news_* в схеме trendsetter_hub (db/09_news.sql). Читатель — доступ view/run к модулю news (viewer — нет).
Редактор — «Ответственный» на news или администратор (is_editor). Время «прошло / открыто / истекло» считается от _now() (параметр :now в SQL).
В журнал (log_action, module_id='news') пишутся только id, kind, status и имена изменённых полей — заголовки, тексты и комментарии модератора не пишутся.
Текст записей — plain text.
Статусы: draft | pending | needs_changes | published | rejected. Предложка: сотрудник-читатель подаёт запись (created_by = автор,
submitted_at IS NOT NULL) -> pending; редактор проверяет: approve -> published, return -> needs_changes, reject -> rejected;
автор дорабатывает и подаёт снова (needs_changes / rejected -> pending). Редакторский PATCH не меняет статус и архив у pending и не трогает
needs_changes / rejected (обход модерации закрыт). Проверка защищена от гонки через expectedUpdatedAt (docs/TZ-news-moderation.md, решения 1-8).
Уведомления (колокольчик) — только автору при решении (решение 7); о новом событии и плашке не делаются, редакторам о предложении — только бейдж.
TODO(Q-N12): журнал news.* пишется только в БД; читалки в интерфейсе нет, HR-журнал эти действия не показывает.
"""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import messages as m
from app.core.access import can_manage_users, can_see_data
from app.core.audit import log_action
from app.core.deps import module_rights
from app.core.models import User
from app.core.notifications import notify

MODULE_ID = "news"
N = "trendsetter_hub.news_"
FEED_LIMIT = 5

MSG_START_REQUIRED = "Укажите дату и время начала"
MSG_END_BEFORE_START = "Окончание раньше начала"
MSG_DEADLINE_AFTER_START = "Срок ответа позже начала события"
MSG_NEWS_FIELDS = "Для новости эти поля не используются"
MSG_RSVP_OFF = "Голосование для этой записи не включено"
MSG_RSVP_CLOSED = "Приём ответов закрыт"
MSG_BANNER_PAST = "Время окончания плашки уже прошло"
MSG_BANNER_CONFLICT = "Плашка обновляется другим пользователем, повторите"
MSG_ALREADY_PUBLISHED = "Предложение уже опубликовано"
MSG_ALREADY_REVIEWED = "Предложение уже рассмотрено"
MSG_STALE = "Запись изменилась, обновите список"
MSG_AT_AUTHOR = "Запись у автора на доработке"
MSG_USE_REVIEW = "Используйте кнопки проверки"
MSG_OPEN_LIMIT = "Не больше 3 предложений на проверке одновременно — дождитесь решения редактора"
MSG_DAILY_LIMIT = "Не больше 5 предложений в сутки — попробуйте завтра"
MSG_PINNED_CHANGED = "Список изменился, обновите"

PROPOSAL_OPEN_LIMIT = 3
PROPOSAL_DAILY_LIMIT = 5
PROPOSAL_LINK = "/profile?section=proposals"
MINE_LIMIT = 50

# camelCase (контракт) -> столбец
FIELDS = {
    "title": "title",
    "body": "body",
    "place": "place",
    "startsAt": "starts_at",
    "endsAt": "ends_at",
    "pinned": "pinned",
    "rsvpEnabled": "rsvp_enabled",
    "rsvpDeadline": "rsvp_deadline",
    "rsvpNamesPublic": "rsvp_names_public",
    "color": "color",
}
NEWS_NULL_FIELDS = ("place", "starts_at", "ends_at", "rsvp_deadline")
NEWS_FALSE_FIELDS = ("rsvp_enabled", "rsvp_names_public")

CURRENT_EVENT = "(kind = 'event' AND NOT archived AND coalesce(ends_at, starts_at) >= :now)"
CURRENT_NEWS = "(kind = 'news' AND NOT archived)"
PAST = "(archived OR (kind = 'event' AND coalesce(ends_at, starts_at) < :now))"
PINNED_SORT = "CASE WHEN pinned THEN sort END ASC NULLS LAST"  # ручной порядок только среди закреплённых
TABS = {
    "current": (
        f"status = 'published' AND ({CURRENT_EVENT} OR {CURRENT_NEWS})",
        f"pinned DESC, (kind = 'news') ASC, {PINNED_SORT}, starts_at ASC NULLS LAST, published_at DESC, id DESC",
    ),
    "past": (
        f"(status = 'published' AND {PAST}) OR status = 'rejected'",
        "coalesce(starts_at, published_at, reviewed_at) DESC, id DESC",
    ),
    "drafts": ("status = 'draft'", "updated_at DESC, id DESC"),
    "review": ("status IN ('pending', 'needs_changes')", "(status = 'pending') DESC, submitted_at ASC, id ASC"),
}
OPEN_STATUSES = ("pending", "needs_changes")


def _now() -> datetime:
    """Текущее время (UTC, aware). Подменяется в тестах."""
    return datetime.now(timezone.utc)


def fail(status: int, message: str):
    raise HTTPException(status, message)


# ---------- права ----------


def access_of(session: Session, user: User) -> str:
    return module_rights(session, user, [MODULE_ID])[MODULE_ID][0]


def can_read(access: str) -> bool:
    """Читатель: view или run (viewer на for_all-модуле имеет structure — не читатель)."""
    return can_see_data(access)


# TODO(Q-N3): superuser без явного права не редактор
def is_editor(session: Session, user: User) -> bool:
    return module_rights(session, user, [MODULE_ID])[MODULE_ID][1] or can_manage_users(
        access_level=user.access_level, is_active=user.is_active
    )


# ---------- представление ----------


def _iso(value: datetime | None) -> str | None:
    return value.astimezone(timezone.utc).isoformat() if value is not None else None


def _rsvp_data(session: Session, rows: list, user: User) -> tuple[dict[int, dict], dict[int, str]]:
    ids = [r["id"] for r in rows if r["rsvp_enabled"]]
    counts: dict[int, dict] = {i: {"yes": 0, "maybe": 0, "no": 0} for i in ids}
    mine: dict[int, str] = {}
    if ids:
        for item_id, answer, n in session.execute(
            text(
                f"SELECT r.item_id, r.answer, count(*) FROM {N}rsvp r JOIN trendsetter_hub.users u ON u.id = r.user_id AND u.is_active "
                "WHERE r.item_id = ANY(:ids) GROUP BY r.item_id, r.answer"
            ),
            {"ids": ids},
        ):
            counts[item_id][answer] = n
        mine = dict(
            session.execute(text(f"SELECT item_id, answer FROM {N}rsvp WHERE user_id = :u AND item_id = ANY(:ids)"), {"u": user.id, "ids": ids}).all()
        )
    return counts, mine


def _is_past(row, now: datetime) -> bool:
    # TODO(Q-N7): событие без окончания исчезает с главной в момент начала
    return row["kind"] == "event" and (row["ends_at"] or row["starts_at"]) < now


def _rsvp_open(row, now: datetime) -> bool:
    return (
        row["status"] == "published"
        and not row["archived"]
        and not _is_past(row, now)
        and now < (row["rsvp_deadline"] or row["starts_at"])
    )


def _authors(session: Session, rows: list) -> dict[int, str]:
    ids = sorted({r["created_by"] for r in rows if r["submitted_at"] is not None and r["created_by"] is not None})
    if not ids:
        return {}
    return dict(session.execute(text("SELECT id, full_name FROM trendsetter_hub.users WHERE id = ANY(:ids)"), {"ids": ids}).all())


def _review(r, authors: dict[int, str]) -> dict | None:
    if r["submitted_at"] is None:
        return None
    author_id = r["created_by"]
    return {
        "author": {"id": author_id, "name": authors[author_id]} if author_id in authors else None,
        "submittedAt": _iso(r["submitted_at"]),
        "reviewComment": r["review_comment"],
        "reviewedAt": _iso(r["reviewed_at"]),
    }


def _items(session: Session, rows: list, user: User, editor: bool, now: datetime, review: bool = False) -> list[dict]:
    """review=True — добавляет ключ review (списки редактора и собственные записи автора); /feed, rsvp, responses его не получают."""
    counts, mine = _rsvp_data(session, rows, user)
    authors = _authors(session, rows) if review else {}
    result = []
    for r in rows:
        rsvp = None
        if r["rsvp_enabled"]:
            rsvp = {
                "open": _rsvp_open(r, now),
                "counts": counts[r["id"]],
                "myAnswer": mine.get(r["id"]),
                "canSeeNames": editor or r["rsvp_names_public"],
            }
        result.append(
            {
                "id": r["id"],
                "kind": r["kind"],
                "title": r["title"],
                "body": r["body"],
                "place": r["place"],
                "startsAt": _iso(r["starts_at"]),
                "endsAt": _iso(r["ends_at"]),
                "pinned": r["pinned"],
                "color": r["color"],
                "status": r["status"],
                "archived": r["archived"],
                "publishedAt": _iso(r["published_at"]),
                "updatedAt": _iso(r["updated_at"]),
                "rsvpEnabled": r["rsvp_enabled"],
                "rsvpDeadline": _iso(r["rsvp_deadline"]),
                "rsvpNamesPublic": r["rsvp_names_public"],
                "rsvp": rsvp,
                **({"review": _review(r, authors)} if review else {}),
            }
        )
    return result


def _row(session: Session, item_id: int):
    return session.execute(text(f"SELECT * FROM {N}items WHERE id = :id"), {"id": item_id}).mappings().first()


# ---------- выборки ----------


def feed(session: Session, user: User, editor: bool) -> dict:
    now = _now()
    events = session.execute(
        text(
            f"SELECT * FROM {N}items WHERE status = 'published' AND {CURRENT_EVENT} "
            f"ORDER BY pinned DESC, {PINNED_SORT}, starts_at ASC, id ASC LIMIT :n"
        ),
        {"now": now, "n": FEED_LIMIT},
    ).mappings().all()
    # TODO(Q-N9): новости на главной не устаревают сами (только архив вручную)
    news = session.execute(
        text(
            f"SELECT * FROM {N}items WHERE status = 'published' AND {CURRENT_NEWS} "
            f"ORDER BY pinned DESC, {PINNED_SORT}, published_at DESC, id DESC LIMIT :n"
        ),
        {"n": FEED_LIMIT},
    ).mappings().all()
    return {"events": _items(session, events, user, editor, now), "news": _items(session, news, user, editor, now)}


def list_items(session: Session, user: User, tab: str, limit: int, offset: int, kind: str | None = None) -> dict:
    now = _now()
    where, order = TABS[tab]
    params = {"now": now}
    if kind:
        where = f"({where}) AND kind = :kind"  # скобки обязательны: в условиях past и current есть OR
        params["kind"] = kind
    total = session.execute(text(f"SELECT count(*) FROM {N}items WHERE {where}"), params).scalar_one()
    rows = session.execute(
        text(f"SELECT * FROM {N}items WHERE {where} ORDER BY {order} LIMIT :limit OFFSET :offset"),
        {**params, "limit": limit, "offset": offset},
    ).mappings().all()
    return {"items": _items(session, rows, user, True, now, review=True), "total": total}


# ---------- создание и правка ----------


def _validate_state(state: dict) -> None:
    """Проверка итогового состояния записи (зеркало CHECK из db/09_news.sql)."""
    if state["kind"] == "news":
        if any(state[f] is not None for f in NEWS_NULL_FIELDS) or any(state[f] for f in NEWS_FALSE_FIELDS):
            fail(422, MSG_NEWS_FIELDS)
        return
    if state["starts_at"] is None:
        fail(422, MSG_START_REQUIRED)
    if state["ends_at"] is not None and state["ends_at"] < state["starts_at"]:
        fail(422, MSG_END_BEFORE_START)
    if state["rsvp_deadline"] is not None and state["rsvp_deadline"] > state["starts_at"]:
        fail(422, MSG_DEADLINE_AFTER_START)


def create_item(session: Session, user: User, data: dict) -> dict:
    """data — значения в camelCase плюс kind и status; обязательные поля и типы проверила модель запроса."""
    now = _now()
    state = {"kind": data["kind"], "status": data["status"]}
    for camel, column in FIELDS.items():
        state[column] = data.get(camel)
    _validate_state(state)
    row = session.execute(
        text(
            f"INSERT INTO {N}items (kind, title, body, place, starts_at, ends_at, pinned, color, status, rsvp_enabled, rsvp_deadline, rsvp_names_public, "
            "published_at, created_by, created_at, updated_by, updated_at) "
            "VALUES (:kind, :title, :body, :place, :starts_at, :ends_at, :pinned, :color, :status, :rsvp_enabled, :rsvp_deadline, :rsvp_names_public, "
            ":published_at, :uid, :now, :uid, :now) RETURNING *"
        ),
        {**state, "published_at": now if state["status"] == "published" else None, "uid": user.id, "now": now},
    ).mappings().one()
    log_action(session, user.id, "news.create", MODULE_ID, news_id=row["id"], kind=row["kind"], status=row["status"])
    session.commit()
    return _items(session, [row], user, True, now, review=True)[0]


def update_item(session: Session, user: User, item_id: int, data: dict) -> dict:
    """data — только переданные поля (camelCase, типы уже проверены моделью запроса)."""
    now = _now()
    current = session.execute(text(f"SELECT * FROM {N}items WHERE id = :id FOR UPDATE"), {"id": item_id}).mappings().first()
    if current is None:
        fail(404, m.NOT_FOUND)
    if current["status"] in ("needs_changes", "rejected"):
        fail(409, MSG_AT_AUTHOR)
    if current["status"] == "pending" and ("status" in data or "archived" in data):
        fail(409, MSG_USE_REVIEW)
    state = dict(current)
    for camel, value in data.items():
        state[FIELDS.get(camel, camel)] = value  # status и archived — столбцы с тем же именем
    _validate_state(state)
    changed = sorted(camel for camel, column in FIELDS.items() if camel in data and state[column] != current[column])
    status_changed = state["status"] != current["status"]
    archive_changed = state["archived"] != current["archived"]
    if not (changed or status_changed or archive_changed):
        return _items(session, [current], user, True, now, review=True)[0]
    if state["pinned"] != current["pinned"]:
        state["sort"] = None  # смена закрепления в любую сторону сбрасывает ручной порядок
    published_at = current["published_at"]
    if state["status"] == "published" and published_at is None:
        published_at = now
    row = session.execute(
        text(
            f"UPDATE {N}items SET title = :title, body = :body, place = :place, starts_at = :starts_at, ends_at = :ends_at, pinned = :pinned, sort = :sort, "
            "color = :color, status = :status, archived = :archived, rsvp_enabled = :rsvp_enabled, rsvp_deadline = :rsvp_deadline, "
            "rsvp_names_public = :rsvp_names_public, published_at = :published_at, updated_by = :uid, updated_at = :now WHERE id = :id RETURNING *"
        ),
        {**state, "published_at": published_at, "uid": user.id, "now": now, "id": item_id},
    ).mappings().one()
    if changed:
        log_action(session, user.id, "news.update", MODULE_ID, news_id=item_id, fields=changed)
    if status_changed:
        log_action(session, user.id, "news.publish" if state["status"] == "published" else "news.unpublish", MODULE_ID, news_id=item_id)
    if archive_changed:
        log_action(session, user.id, "news.archive" if state["archived"] else "news.unarchive", MODULE_ID, news_id=item_id)
    session.commit()
    return _items(session, [row], user, True, now, review=True)[0]


def pinned_order(session: Session, user: User, kind: str, ids: list[int]) -> dict:
    """Ручной порядок закреплённых одного типа: ids должен точно совпасть с текущим набором закреплённых; sort = индекс."""
    where = CURRENT_EVENT if kind == "event" else CURRENT_NEWS
    current = set(
        session.scalars(
            text(f"SELECT id FROM {N}items WHERE status = 'published' AND pinned AND {where} FOR UPDATE"), {"now": _now()}
        ).all()
    )
    if len(ids) != len(set(ids)) or set(ids) != current:
        fail(409, MSG_PINNED_CHANGED)
    for index, item_id in enumerate(ids):
        session.execute(text(f"UPDATE {N}items SET sort = :s WHERE id = :id"), {"s": index, "id": item_id})
    log_action(session, user.id, "news.reorder", MODULE_ID, kind=kind, count=len(ids))
    session.commit()
    return {"ok": True}


def delete_item(session: Session, user: User, item_id: int) -> dict:
    kind = session.execute(text(f"DELETE FROM {N}items WHERE id = :id RETURNING kind"), {"id": item_id}).scalar_one_or_none()
    if kind is None:
        fail(404, m.NOT_FOUND)
    log_action(session, user.id, "news.delete", MODULE_ID, news_id=item_id, kind=kind)
    session.commit()
    return {"ok": True}


# ---------- предложка (автор) ----------


def _open_count(session: Session, user: User) -> int:
    return session.execute(
        text(f"SELECT count(*) FROM {N}items WHERE created_by = :u AND submitted_at IS NOT NULL AND status IN ('pending', 'needs_changes')"),
        {"u": user.id},
    ).scalar_one()


def _check_open_limit(session: Session, user: User) -> None:
    # TODO(Q-NM16): гонка двух одновременных подач одного автора не закрыта (превышение на 1 допустимо)
    if _open_count(session, user) >= PROPOSAL_OPEN_LIMIT:
        fail(429, MSG_OPEN_LIMIT)


def _check_daily_limit(session: Session, user: User, now: datetime) -> None:
    sent = session.execute(
        text(f"SELECT count(*) FROM {N}items WHERE created_by = :u AND submitted_at IS NOT NULL AND created_at > :since"),
        {"u": user.id, "since": now - timedelta(hours=24)},
    ).scalar_one()
    if sent >= PROPOSAL_DAILY_LIMIT:
        fail(429, MSG_DAILY_LIMIT)


def my_proposals(session: Session, user: User, editor: bool) -> dict:
    now = _now()
    rows = session.execute(
        text(
            f"SELECT * FROM {N}items WHERE created_by = :u AND submitted_at IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT :n"
        ),
        {"u": user.id, "n": MINE_LIMIT},
    ).mappings().all()
    return {"items": _items(session, rows, user, editor, now, review=True)}


def create_proposal(session: Session, user: User, data: dict, editor: bool) -> dict:
    """data — поля ProposalBody (camelCase, без pinned и status); запись создаётся pending, не закреплённой."""
    now = _now()
    state = {"kind": data["kind"], "status": "pending"}
    for camel, column in FIELDS.items():
        state[column] = data.get(camel)
    state["pinned"] = False
    _validate_state(state)
    _check_open_limit(session, user)
    _check_daily_limit(session, user, now)
    row = session.execute(
        text(
            f"INSERT INTO {N}items (kind, title, body, place, starts_at, ends_at, pinned, color, status, rsvp_enabled, rsvp_deadline, rsvp_names_public, "
            "published_at, submitted_at, created_by, created_at, updated_by, updated_at) "
            "VALUES (:kind, :title, :body, :place, :starts_at, :ends_at, :pinned, :color, :status, :rsvp_enabled, :rsvp_deadline, :rsvp_names_public, "
            "NULL, :now, :uid, :now, :uid, :now) RETURNING *"
        ),
        {**state, "uid": user.id, "now": now},
    ).mappings().one()
    log_action(session, user.id, "news.submit", MODULE_ID, news_id=row["id"], kind=row["kind"])
    session.commit()
    return _items(session, [row], user, editor, now, review=True)[0]


def update_proposal(session: Session, user: User, item_id: int, data: dict, editor: bool) -> dict:
    """data — только переданные поля ProposalPatchBody. Итог всегда pending (переотправка после доработки)."""
    now = _now()
    current = session.execute(text(f"SELECT * FROM {N}items WHERE id = :id FOR UPDATE"), {"id": item_id}).mappings().first()
    if current is None or current["created_by"] != user.id or current["submitted_at"] is None:
        fail(404, m.NOT_FOUND)
    if current["status"] not in ("pending", "needs_changes", "rejected"):
        # published (в т. ч. в архиве) и снятое с публикации в draft автору не правятся
        fail(409, MSG_ALREADY_PUBLISHED)
    state = dict(current)
    for camel, value in data.items():
        state[FIELDS[camel]] = value
    _validate_state(state)
    changed = sorted(camel for camel, column in FIELDS.items() if camel in data and state[column] != current[column])
    if current["status"] == "pending" and not changed:
        return _items(session, [current], user, editor, now, review=True)[0]
    if current["status"] == "rejected":
        _check_open_limit(session, user)
    submitted_at = current["submitted_at"] if current["status"] == "pending" else now
    row = session.execute(
        text(
            f"UPDATE {N}items SET title = :title, body = :body, place = :place, starts_at = :starts_at, ends_at = :ends_at, color = :color, "
            "rsvp_enabled = :rsvp_enabled, rsvp_deadline = :rsvp_deadline, rsvp_names_public = :rsvp_names_public, "
            "status = 'pending', submitted_at = :submitted_at, updated_by = :uid, updated_at = :now WHERE id = :id RETURNING *"
        ),
        {**state, "submitted_at": submitted_at, "uid": user.id, "now": now, "id": item_id},
    ).mappings().one()
    log_action(session, user.id, "news.resubmit", MODULE_ID, news_id=item_id, fields=changed)
    session.commit()
    return _items(session, [row], user, editor, now, review=True)[0]


# ---------- проверка (редактор) ----------

REVIEW_ACTIONS = {
    "approve": ("published", "news.approve", "Ваша новость опубликована"),
    "return": ("needs_changes", "news.return", "Новость нужно доработать"),
    "reject": ("rejected", "news.reject", "Новость отклонена"),
}


def _review_body(action: str, title: str, comment: str | None) -> str:
    if action == "approve":
        return title
    if action == "return":
        return f"«{title}»: {comment}"
    return f"«{title}». Причина: {comment}. Можно доработать и отправить снова."


def review_item(session: Session, user: User, item_id: int, action: str, comment: str | None, expected_updated_at: datetime) -> dict:
    """Решение по предложению из pending; comment — для return/reject. Уведомление уходит только автору (не себе и не неактивному)."""
    now = _now()
    status, log_name, title = REVIEW_ACTIONS[action]
    current = session.execute(text(f"SELECT * FROM {N}items WHERE id = :id FOR UPDATE"), {"id": item_id}).mappings().first()
    if current is None:
        fail(404, m.NOT_FOUND)
    if current["status"] != "pending":
        fail(409, MSG_ALREADY_REVIEWED)
    if current["updated_at"] != expected_updated_at:
        fail(409, MSG_STALE)
    row = session.execute(
        text(
            f"UPDATE {N}items SET status = :status, review_comment = coalesce(:comment, review_comment), "
            "published_at = CASE WHEN :status = 'published' THEN coalesce(published_at, :now) ELSE published_at END, "
            "reviewed_by = :uid, reviewed_at = :now, updated_by = :uid, updated_at = :now WHERE id = :id RETURNING *"
        ),
        {"status": status, "comment": comment, "uid": user.id, "now": now, "id": item_id},
    ).mappings().one()
    author_id = row["created_by"]
    if author_id is not None and author_id != user.id and session.scalar(
        text("SELECT is_active FROM trendsetter_hub.users WHERE id = :id"), {"id": author_id}
    ):
        notify(session, [author_id], "news_review", title, _review_body(action, row["title"], comment), PROPOSAL_LINK)
    log_action(session, user.id, log_name, MODULE_ID, news_id=item_id)
    session.commit()
    return _items(session, [row], user, True, now, review=True)[0]


def badge(session: Session, user: User) -> int:
    """Бейдж пункта меню «Редактор новостей»: число предложений на проверке (только редактору)."""
    if not is_editor(session, user):
        return 0
    return session.execute(text(f"SELECT count(*) FROM {N}items WHERE status = 'pending'")).scalar_one()


# ---------- «Кто пойдёт» ----------


def set_rsvp(session: Session, user: User, item_id: int, answer: str, editor: bool) -> dict:
    row = _row(session, item_id)
    if row is None or row["status"] != "published":
        fail(404, m.NOT_FOUND)
    now = _now()
    if row["kind"] != "event" or not row["rsvp_enabled"]:
        fail(409, MSG_RSVP_OFF)
    if not _rsvp_open(row, now):
        fail(409, MSG_RSVP_CLOSED)
    # TODO(Q-N10): отозвать ответ нельзя, только сменить
    session.execute(
        text(
            f"INSERT INTO {N}rsvp (item_id, user_id, answer, updated_at) VALUES (:i, :u, :a, :now) "
            "ON CONFLICT (item_id, user_id) DO UPDATE SET answer = EXCLUDED.answer, updated_at = EXCLUDED.updated_at"
        ),
        {"i": item_id, "u": user.id, "a": answer, "now": now},
    )
    session.commit()
    return _items(session, [row], user, editor, now)[0]


def responses(session: Session, item_id: int, editor: bool) -> dict:
    row = _row(session, item_id)
    if row is None or (row["status"] != "published" and not editor):
        fail(404, m.NOT_FOUND)
    if not editor and not (row["rsvp_enabled"] and row["rsvp_names_public"]):
        fail(403, m.FORBIDDEN)
    result: dict[str, list] = {"yes": [], "maybe": [], "no": []}
    for user_id, name, answer, updated_at in session.execute(
        text(
            f"SELECT u.id, u.full_name, r.answer, r.updated_at FROM {N}rsvp r JOIN trendsetter_hub.users u ON u.id = r.user_id "
            "WHERE r.item_id = :i AND u.is_active ORDER BY u.full_name, u.id"
        ),
        {"i": item_id},
    ):
        result[answer].append({"userId": user_id, "name": name, "updatedAt": _iso(updated_at)})
    return result


# ---------- срочная плашка ----------


def _banner(row) -> dict | None:
    return {"id": row[0], "text": row[1], "endsAt": _iso(row[2])} if row is not None else None


def get_banner(session: Session) -> dict:
    row = session.execute(
        text(f"SELECT id, text, ends_at FROM {N}banners WHERE active AND (ends_at IS NULL OR ends_at > :now) LIMIT 1"), {"now": _now()}
    ).first()
    return {"banner": _banner(row)}


def set_banner(session: Session, user: User, banner_text: str, ends_at: datetime | None) -> dict:
    now = _now()
    if ends_at is not None and ends_at <= now:
        fail(422, MSG_BANNER_PAST)
    try:
        # Тот же текст (в т.ч. истёкшая) — обновляем строку, id сохраняется: скрывшие плашку не увидят её заново
        row = session.execute(
            text(f"UPDATE {N}banners SET ends_at = :e, updated_at = :now WHERE active AND text = :t RETURNING id, text, ends_at"),
            {"e": ends_at, "t": banner_text, "now": now},
        ).first()
        if row is not None:
            log_action(session, user.id, "news.banner_update", MODULE_ID, banner_id=row[0])
        else:
            session.execute(text(f"UPDATE {N}banners SET active = false, updated_at = :now WHERE active"), {"now": now})
            row = session.execute(
                text(
                    f"INSERT INTO {N}banners (text, active, ends_at, created_by, created_at, updated_at) VALUES (:t, true, :e, :u, :now, :now) "
                    "RETURNING id, text, ends_at"
                ),
                {"t": banner_text, "e": ends_at, "u": user.id, "now": now},
            ).first()
            log_action(session, user.id, "news.banner_set", MODULE_ID, banner_id=row[0])
        session.commit()
    except IntegrityError:
        session.rollback()
        fail(409, MSG_BANNER_CONFLICT)
    return {"banner": _banner(row)}


def banner_off(session: Session, user: User) -> dict:
    ids = session.scalars(
        text(f"UPDATE {N}banners SET active = false, updated_at = :now WHERE active RETURNING id"), {"now": _now()}
    ).all()
    for banner_id in ids:
        log_action(session, user.id, "news.banner_off", MODULE_ID, banner_id=banner_id)
    session.commit()
    return {"banner": None}
