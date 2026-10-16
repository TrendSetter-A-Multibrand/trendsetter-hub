"""Проверки форм. Возвращают None (ок) или текст ошибки; зеркало frontend/src/core/admin/validation.js."""
import re

from app.core import messages as m
from app.core.access import ACCESS_LEVELS
from app.core.security import password_is_valid

# TODO(Q-D): ограничение корпоративного домена почты не решено — пока проверяется только формат.
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
CODE_RE = re.compile(r"^[a-z][a-z0-9_]{1,31}$")


def is_valid_email(email: str | None) -> bool:
    return bool(EMAIL_RE.match((email or "").strip()))


def validate_department_name(name: str | None, existing: list[tuple[int, str]], self_id: int | None = None) -> str | None:
    value = (name or "").strip()
    if not value:
        return m.NAME_EMPTY
    if len(value) > 64:
        return m.NAME_TOO_LONG
    lower = value.lower()
    if any(dep_id != self_id and dep_name.strip().lower() == lower for dep_id, dep_name in existing):
        return m.NAME_DUPLICATE
    return None


def validate_department_code(code: str | None, existing_codes: list[str]) -> str | None:
    if not CODE_RE.match(code or ""):
        return m.CODE_INVALID
    return m.CODE_DUPLICATE if code in existing_codes else None


def validate_new_user(email: str, full_name: str, access_level: str, password: str, existing_emails: list[str]) -> str | None:
    if not is_valid_email(email):
        return m.EMAIL_INVALID
    if email.strip().lower() in {e.lower() for e in existing_emails}:
        return m.EMAIL_DUPLICATE
    if not (full_name or "").strip():
        return m.FULL_NAME_EMPTY
    if access_level not in ACCESS_LEVELS:
        return m.LEVEL_INVALID
    if not password_is_valid(password):
        return m.PASSWORD_INVALID
    return None
