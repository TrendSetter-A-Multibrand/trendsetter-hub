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
