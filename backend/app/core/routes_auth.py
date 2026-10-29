import threading
import time
from collections import deque

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import messages as m
from app.core.audit import log_action
from app.core import onboarding
from app.core.deps import get_authenticated_user
from app.core.models import User
from app.core.security import CHANGE_MAX_CHARS, CHANGE_MIN_LEN, DUMMY_HASH, MAX_PASSWORD_BYTES, create_token, hash_password, verify_password
from app.db.database import get_session

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginBody(BaseModel):
    email: str
    password: str


@router.post("/login")
def login(body: LoginBody, session: Session = Depends(get_session)) -> dict:
    raw_email = body.email.strip()
    email_key = raw_email.lower()
    counter_key = email_key[:320]  # ключ счётчика ограничен по длине: длинные «почты» не раздувают память
    now = time.monotonic()
    with _attempts_lock:
        # Лимит на почту (в том числе несуществующую) проверяется до любой проверки bcrypt
        if len(_recent_login_failures(counter_key, now)) >= MAX_FAILED_ATTEMPTS:
            raise HTTPException(429, m.TOO_MANY_ATTEMPTS)
        fuse_tripped = _unknown_email_fuse_tripped(now)
    user = session.scalar(select(User).where(func.lower(User.email) == email_key))
    existed = user is not None
    settings_row = onboarding.settings_row(session)
    shared_hash = settings_row.password_hash if settings_row else None
    # D3: на любом пути ровно две проверки bcrypt (общий хэш или фиктивный + личный хэш или фиктивный); результаты сводятся после обеих.
    # Пароли сравниваются только через verify_password (bcrypt), не через ==.
    ok_shared = False
    if user is not None:
        eligible = shared_hash is not None and onboarding.shared_eligible(user)
        v_shared = verify_password(body.password, shared_hash if eligible else DUMMY_HASH)
        v_own = verify_password(body.password, user.password_hash)
        ok_shared = eligible and v_shared
        ok = user.is_active and (ok_shared or v_own)
    else:
        # Самосоздание: общий пароль задан, почта проходит D2 (ASCII до приведения регистра), предохранитель D4 не сработал
        can = shared_hash is not None and raw_email.isascii() and onboarding.self_register_email_ok(email_key) and not fuse_tripped
        v_shared = verify_password(body.password, shared_hash if can else DUMMY_HASH)
        verify_password(body.password, DUMMY_HASH)  # выравнивание: вторая проверка, как у существующей учётки
        ok = ok_shared = can and v_shared
        if ok:
            user = onboarding.self_register(session, email_key)  # 429 ONBOARDING_LIMIT; None — почта успела появиться
            ok = ok_shared = user is not None
    if not ok:
        _record_login_failure(counter_key, existed, now)
        raise HTTPException(401, m.BAD_CREDENTIALS)
    with _attempts_lock:
        _login_failures.pop(counter_key, None)
    user.last_login_at = func.now()
    log_action(session, user.id, "login", **({"onboarding_password": True} if ok_shared else {}))
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
# Неудачные входы: не больше 5 за 15 минут на почту (ключ — email.strip().lower()), включая несуществующие почты.
# TODO(Q-S2): так же в памяти процесса.
_login_failures: dict[str, list[float]] = {}
LOGIN_KEYS_LIMIT = 10_000  # D11: сверх этого при записи сначала удаляются устаревшие ключи
# D4: глобальный предохранитель от подбора общего пароля перебором почт: неудачи по НЕсуществующим почтам за 15 минут.
# TODO(Q-S2): так же в памяти процесса.
UNKNOWN_EMAIL_FAILS_LIMIT = 30
_unknown_email_fails: deque[float] = deque(maxlen=UNKNOWN_EMAIL_FAILS_LIMIT * 4)


def reset_password_attempts() -> None:
    """Сброс счётчиков (для тестов)."""
    with _attempts_lock:
        _failed_attempts.clear()
        _login_failures.clear()
        _unknown_email_fails.clear()


def _recent_login_failures(key: str, now: float) -> list[float]:
    recent = [t for t in _login_failures.get(key, []) if now - t < ATTEMPT_WINDOW_SECONDS]
    if recent:
        _login_failures[key] = recent
    else:
        _login_failures.pop(key, None)
    return recent


def _unknown_email_fuse_tripped(now: float) -> bool:
    return sum(1 for t in _unknown_email_fails if now - t < ATTEMPT_WINDOW_SECONDS) >= UNKNOWN_EMAIL_FAILS_LIMIT


def _record_login_failure(key: str, existed: bool, now: float) -> None:
    with _attempts_lock:
        if len(_login_failures) > LOGIN_KEYS_LIMIT:
            for stale in [k for k, times in _login_failures.items() if all(now - t >= ATTEMPT_WINDOW_SECONDS for t in times)]:
                del _login_failures[stale]
        _login_failures.setdefault(key, []).append(now)
        if not existed:
            _unknown_email_fails.append(now)


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
def change_password(body: ChangePasswordBody, user: User = Depends(get_authenticated_user), session: Session = Depends(get_session)) -> dict:
    now = time.monotonic()
    with _attempts_lock:
        if len(_recent_failures(user.id, now)) >= MAX_FAILED_ATTEMPTS:
            raise HTTPException(429, m.TOO_MANY_ATTEMPTS)
    # «Текущий пароль»: личный или (только пока шаг «пароль» новичка) общий стартовый
    if not (verify_password(body.oldPassword, user.password_hash) or onboarding.shared_password_ok(session, user, body.oldPassword)):
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
    if user.must_change_password and onboarding.shared_password_ok(session, user, new):
        raise HTTPException(422, m.NEW_PASSWORD_SAME)  # новый пароль не может совпадать с общим стартовым
    with _attempts_lock:
        _failed_attempts.pop(user.id, None)
    was_onboarding_step = user.must_change_password
    user.password_hash = hash_password(new)
    user.token_version = (user.token_version or 0) + 1  # прежние сессии закрыты
    user.must_change_password = False
    # только id и признак шага, без значений
    log_action(session, user.id, "core.password_change", target_user_id=user.id, **({"onboarding_password": True} if was_onboarding_step else {}))
    session.commit()
    return {"token": create_token(user.id, user.token_version)}
