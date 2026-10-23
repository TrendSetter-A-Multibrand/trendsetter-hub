from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.access import can_manage_users
from app.core.deps import get_current_user, module_rights
from app.core.models import Department, Notification, User, UserDepartment
from app.core.notifications import unread_count
from app.core.registry import MODULES
from app.db.database import get_session

router = APIRouter(prefix="/core", tags=["core"])


@router.get("/me")
def me(user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict:
    departments = session.scalars(
        select(Department)
        .join(UserDepartment, UserDepartment.department_id == Department.id)
        .where(UserDepartment.user_id == user.id)
        .order_by(Department.id)
    ).all()
    rights = module_rights(session, user, [mod.id for mod in MODULES])
    badges = {mod.id: n for mod in MODULES if mod.badge is not None and (n := mod.badge(session, user))}
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "access_level": user.access_level,
        "departments": [{"id": d.id, "code": d.code, "name": d.name} for d in departments],
        "can_manage_users": can_manage_users(access_level=user.access_level, is_active=user.is_active),
        "module_access": {module_id: access for module_id, (access, _) in rights.items()},
        "module_responsible": {module_id: responsible for module_id, (_, responsible) in rights.items()},
        "module_badges": badges,
        "unread_notifications": unread_count(session, user.id),
    }


@router.get("/runs")
def runs(limit: int = 5, user: User = Depends(get_current_user)) -> list:
    # Таблицы задач пока нет (очередь — следующий этап): «последние запуски» пусты
    return []


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
