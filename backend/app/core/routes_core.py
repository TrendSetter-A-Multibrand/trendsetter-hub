import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, StringConstraints, field_validator
from sqlalchemy import func, select, text, update
from sqlalchemy.orm import Session

from app.core import home
from app.core import messages as m
from app.core.access import can_manage_users
from app.core.audit import log_action
from app.core.deps import get_authenticated_user, get_current_user, module_rights
from app.core.models import Department, Notification, User, UserDepartment
from app.core.notifications import unread_count
from app.core.registry import MODULES
from app.db.database import get_session

router = APIRouter(prefix="/core", tags=["core"])
log = logging.getLogger(__name__)
DAILY_JOBS_LOCK = 70_007_001  # ключ advisory-блокировки ежедневных задач модулей


def run_daily_jobs(session: Session) -> None:
    """Ежедневные задачи модулей (напоминания). Блокировка на транзакцию: параллельные запросы не дублируют работу;
    «не чаще раза в сутки» обеспечивает сама задача (запись в журнале отметок). Сбой не ломает ответ: откат и строка в лог без данных."""
    jobs = [mod for mod in MODULES if mod.daily_job is not None]
    if not jobs:
        return
    try:
        if not session.execute(text("SELECT pg_try_advisory_xact_lock(:k)"), {"k": DAILY_JOBS_LOCK}).scalar():
            session.rollback()
            return
        for mod in jobs:
            try:
                mod.daily_job(session)
            except Exception as exc:  # noqa: BLE001 — задача модуля не должна ломать /core/me
                session.rollback()
                log.error("daily_job %s: %s", mod.id, type(exc).__name__)
                session.execute(text("SELECT pg_try_advisory_xact_lock(:k)"), {"k": DAILY_JOBS_LOCK})
        session.commit()
    except Exception as exc:  # noqa: BLE001
        session.rollback()
        log.error("daily_jobs: %s", type(exc).__name__)


@router.get("/me")
def me(user: User = Depends(get_authenticated_user), session: Session = Depends(get_session)) -> dict:
    run_daily_jobs(session)
    departments = session.scalars(
        select(Department)
        .join(UserDepartment, UserDepartment.department_id == Department.id)
        .where(UserDepartment.user_id == user.id)
        .order_by(Department.id)
    ).all()
    # Новичок (онбординг): права не вычисляются вовсе — всё закрыто, бейджей и уведомлений нет
    gated = user.must_change_password or user.onboarding
    if gated:
        rights = {mod.id: ("none", False) for mod in MODULES}
        badges: dict = {}
    else:
        rights = module_rights(session, user, [mod.id for mod in MODULES])
        badges = {mod.id: n for mod in MODULES if mod.badge is not None and (n := mod.badge(session, user))}
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "access_level": user.access_level,
        "departments": [{"id": d.id, "code": d.code, "name": d.name} for d in departments],
        "must_change_password": user.must_change_password,
        "onboarding": user.onboarding,
        "can_manage_users": False if gated else can_manage_users(access_level=user.access_level, is_active=user.is_active),
        "module_access": {module_id: access for module_id, (access, _) in rights.items()},
        "module_responsible": {module_id: responsible for module_id, (_, responsible) in rights.items()},
        "module_badges": badges,
        "unread_notifications": 0 if gated else unread_count(session, user.id),
    }


@router.get("/runs")
def runs(limit: int = 5, user: User = Depends(get_current_user)) -> list:
    # Таблицы задач пока нет (очередь — следующий этап): «последние запуски» пусты
    return []


@router.get("/home/weather")
def home_weather(city: str | None = Query(None, max_length=40), user: User = Depends(get_current_user)) -> dict:
    return home.weather_payload(city)


@router.get("/home/rates")
def home_rates(user: User = Depends(get_current_user)) -> dict:
    return home.rates_payload()


WIDGETS_MAX = 30
WidgetId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{1,40}$")]


class WidgetItem(BaseModel):
    id: WidgetId
    enabled: bool


class WidgetsBody(BaseModel):
    widgets: Annotated[list[WidgetItem], Field(min_length=1, max_length=WIDGETS_MAX)]

    @field_validator("widgets")
    @classmethod
    def no_duplicates(cls, value: list[WidgetItem]) -> list[WidgetItem]:
        if len({w.id for w in value}) != len(value):
            raise ValueError("duplicate widget id")
        return value


def _widgets(session: Session) -> dict:
    rows = session.execute(text("SELECT widget_id, enabled FROM trendsetter_hub.home_widgets ORDER BY position, widget_id")).all()
    return {"widgets": [{"id": widget_id, "enabled": enabled} for widget_id, enabled in rows]}


@router.get("/home/widgets")
def home_widgets(user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict:
    # Пустой список = порядок по умолчанию, всё включено; каталог виджетов знает только фронт
    return _widgets(session)


@router.post("/home/widgets")
def set_home_widgets(body: WidgetsBody, user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict:
    editors = [mod.id for mod in MODULES if mod.home_editor]
    rights = module_rights(session, user, editors)
    if not (can_manage_users(access_level=user.access_level, is_active=user.is_active) or any(responsible for _, responsible in rights.values())):
        raise HTTPException(403, m.FORBIDDEN)
    session.execute(text("DELETE FROM trendsetter_hub.home_widgets"))
    for position, widget in enumerate(body.widgets):
        session.execute(
            text("INSERT INTO trendsetter_hub.home_widgets (widget_id, position, enabled, updated_by) VALUES (:w, :p, :e, :u)"),
            {"w": widget.id, "p": position, "e": widget.enabled, "u": user.id},
        )
    log_action(session, user.id, "home.widgets_update", None, count=len(body.widgets), disabled=[w.id for w in body.widgets if not w.enabled])
    session.commit()
    return _widgets(session)


@router.get("/notifications")
def notifications(
    unread: int = 0, limit: int = 30, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> list[dict]:
    query = select(Notification).where(Notification.user_id == user.id)
    if unread:
        query = query.where(Notification.read_at.is_(None))
    rows = session.scalars(query.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(max(1, min(limit, 100)))).all()
    return [
        {
            "id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "link": n.link,
            "createdAt": n.created_at.isoformat(), "read": n.read_at is not None,
        }
        for n in rows
    ]


class ReadBody(BaseModel):
    ids: list[int] | None = None


@router.post("/notifications/read")
def read_notifications(body: ReadBody, user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict:
    query = update(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None)).values(read_at=func.now())
    if body.ids is not None:
        query = query.where(Notification.id.in_(body.ids))
    session.execute(query)
    session.commit()
    return {"ok": True}
