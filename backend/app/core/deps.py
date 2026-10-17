from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core import messages as m
from app.core.access import can_manage_users
from app.core.models import User
from app.core.security import read_token
from app.db.database import get_session

bearer = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: Session = Depends(get_session),
) -> User:
    user_id = read_token(credentials.credentials) if credentials else None
    # Пользователь перечитывается из БД на каждом запросе: отключённый теряет доступ сразу, не дожидаясь конца токена
    user = session.get(User, user_id) if user_id is not None else None
    if user is None or not user.is_active:
        raise HTTPException(401, m.UNAUTHORIZED)
    return user


def require_manager(user: User = Depends(get_current_user)) -> User:
    if not can_manage_users(access_level=user.access_level, is_active=user.is_active):
        raise HTTPException(403, m.FORBIDDEN)
    return user


def require_module_run(module_id: str):
    """Зависимость: пользователь может запускать модуль (admin/superuser или сотрудник отдела модуля)."""
    from sqlalchemy import select

    from app.core.access import can_run, compute_module_access
    from app.core.models import ModuleDepartment, UserDepartment

    def dependency(user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> User:
        own = session.scalars(select(UserDepartment.department_id).where(UserDepartment.user_id == user.id)).all()
        module_deps = session.scalars(select(ModuleDepartment.department_id).where(ModuleDepartment.module_id == module_id)).all()
        access = compute_module_access(
            access_level=user.access_level, is_active=user.is_active, department_ids=own, module_department_ids=module_deps
        )
        if not can_run(access):
            raise HTTPException(403, m.FORBIDDEN)
        return user

    return dependency
