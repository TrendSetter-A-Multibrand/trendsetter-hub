"""Пароли (bcrypt) и токены (JWT)."""
from datetime import UTC, datetime, timedelta

import bcrypt
from jose import JWTError, jwt

from app.config import get_settings

MAX_PASSWORD_BYTES = 72  # ограничение bcrypt
MIN_PASSWORD_LEN = 8
CHANGE_MIN_LEN = 10  # смена пароля сотрудником строже, чем заведение учётки админом
CHANGE_MAX_CHARS = 128
ALGORITHM = "HS256"


def password_is_valid(password: str) -> bool:
    return len(password) >= MIN_PASSWORD_LEN and len(password.encode()) <= MAX_PASSWORD_BYTES


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    raw = password.encode()
    if len(raw) > MAX_PASSWORD_BYTES:
        return False
    try:
        return bcrypt.checkpw(raw, hashed.encode())
    except ValueError:
        return False


# Хэш для выравнивания времени ответа, когда пользователя с такой почтой нет
DUMMY_HASH = hash_password("dummy-password-for-timing")


def create_token(user_id: int, token_version: int = 0) -> str:
    settings = get_settings()
    exp = datetime.now(UTC) + timedelta(minutes=settings.jwt_ttl_minutes)
    return jwt.encode({"sub": str(user_id), "tv": token_version, "exp": exp}, settings.jwt_secret, algorithm=ALGORITHM)


def read_token_claims(token: str) -> tuple[int, int] | None:
    """(id пользователя, версия токена); токен без `tv` (выпущен до 0008) считается версией 0."""
    try:
        payload = jwt.decode(token, get_settings().jwt_secret, algorithms=[ALGORITHM])
        return int(payload["sub"]), int(payload.get("tv", 0))
    except (JWTError, KeyError, ValueError, TypeError):
        return None


def read_token(token: str) -> int | None:
    claims = read_token_claims(token)
    return claims[0] if claims else None
