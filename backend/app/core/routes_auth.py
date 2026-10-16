from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import messages as m
from app.core.audit import log_action
from app.core.models import User
from app.core.security import DUMMY_HASH, create_token, verify_password
from app.db.database import get_session

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginBody(BaseModel):
    email: str
    password: str


@router.post("/login")
def login(body: LoginBody, session: Session = Depends(get_session)) -> dict:
    user = session.scalar(select(User).where(func.lower(User.email) == body.email.strip().lower()))
    # Пароль проверяется всегда (на фиктивном хэше, если пользователя нет): одинаковое время и одинаковый ответ
    password_ok = verify_password(body.password, user.password_hash if user else DUMMY_HASH)
    if user is None or not user.is_active or not password_ok:
        raise HTTPException(401, m.BAD_CREDENTIALS)
    user.last_login_at = func.now()
    log_action(session, user.id, "login")
    session.commit()
    return {"token": create_token(user.id)}


@router.post("/logout")
def logout() -> dict:
    # Токен без состояния на сервере: выход выполняет клиент, забывая токен
    return {}
