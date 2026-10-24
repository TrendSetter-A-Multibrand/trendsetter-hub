import threading
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import messages as m
from app.core.audit import log_action
from app.core.deps import get_current_user
from app.core.models import User
from app.core.security import CHANGE_MAX_CHARS, CHANGE_MIN_LEN, DUMMY_HASH, MAX_PASSWORD_BYTES, create_token, hash_password, verify_password
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
    return {"token": create_token(user.id, user.token_version or 0)}


@router.post("/logout")
def logout() -> dict:
    # Токен без состояния на сервере: выход выполняет клиент, забывая токен
    return {}


# ---------- смена пароля ----------
# Неудачные попытки старого пароля: не больше 5 за 15 минут на пользователя.
# TODO(Q-S2): счётчик в памяти процесса; при нескольких процессах нужен общий (БД/Redis).
MAX_FAILED_ATTEMPTS = 5
ATTEMPT_WINDOW_SECONDS = 15 * 60
_failed_attempts: dict[int, list[float]] = {}
_attempts_lock = threading.Lock()


def reset_password_attempts() -> None:
    """Сброс счётчика (для тестов)."""
    with _attempts_lock:
        _failed_attempts.clear()


def _recent_failures(user_id: int, now: float) -> list[float]:
    recent = [t for t in _failed_attempts.get(user_id, []) if now - t < ATTEMPT_WINDOW_SECONDS]
    if recent:
        _failed_attempts[user_id] = recent
    else:
        _failed_attempts.pop(user_id, None)
    return recent


class ChangePasswordBody(BaseModel):
    oldPassword: str
    newPassword: str


@router.post("/change-password")
def change_password(body: ChangePasswordBody, user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict:
    now = time.monotonic()
    with _attempts_lock:
        if len(_recent_failures(user.id, now)) >= MAX_FAILED_ATTEMPTS:
            raise HTTPException(429, m.TOO_MANY_ATTEMPTS)
    if not verify_password(body.oldPassword, user.password_hash):
        with _attempts_lock:
            _failed_attempts.setdefault(user.id, []).append(now)
        raise HTTPException(401, m.OLD_PASSWORD_WRONG)
    new = body.newPassword
    if len(new) > CHANGE_MAX_CHARS or len(new.encode()) > MAX_PASSWORD_BYTES:  # 72 байта — предел bcrypt
        raise HTTPException(422, m.NEW_PASSWORD_LONG)
    if len(new) < CHANGE_MIN_LEN:
        raise HTTPException(422, m.NEW_PASSWORD_SHORT)
    if new == body.oldPassword:
        raise HTTPException(422, m.NEW_PASSWORD_SAME)
    with _attempts_lock:
        _failed_attempts.pop(user.id, None)
    user.password_hash = hash_password(new)
    user.token_version = (user.token_version or 0) + 1  # прежние сессии закрыты
    log_action(session, user.id, "core.password_change", target_user_id=user.id)  # только id, без значений
    session.commit()
    return {"token": create_token(user.id, user.token_version)}
