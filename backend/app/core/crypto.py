"""Шифрование ПДн на уровне приложения (Fernet). Ключ — HUB_PII_KEY из окружения; несколько ключей через запятую
(первый шифрует, остальные только расшифровывают — ротация). Ключ нигде не логируется и не попадает в ответы.

Форматы хранения: текст — `enc:v1:<токен Fernet>`; байты — `ENC1\n` + токен Fernet.
Значение без префикса считается открытым текстом (обратная совместимость до запуска encrypt_existing).
"""
from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.config import get_settings

TEXT_PREFIX = "enc:v1:"
BYTES_PREFIX = b"ENC1\n"


class KeyMissing(Exception):
    """Ключ шифрования не задан (или заданный ключ не годится)."""


class DecryptError(Exception):
    """Неверный ключ или повреждённый токен. Текст исключения не содержит ни ключа, ни данных."""


def _cipher() -> MultiFernet:
    raw = get_settings().pii_key or ""
    keys = [k.strip() for k in raw.split(",") if k.strip()]
    if not keys:
        raise KeyMissing()
    try:
        return MultiFernet([Fernet(k.encode()) for k in keys])
    except (ValueError, TypeError):
        raise KeyMissing() from None  # ключ неверного формата: считаем, что шифрование не настроено


def key_configured() -> bool:
    try:
        _cipher()
    except KeyMissing:
        return False
    return True


def is_encrypted_text(value: str | None) -> bool:
    return isinstance(value, str) and value.startswith(TEXT_PREFIX)


def is_encrypted_bytes(value: bytes | None) -> bool:
    return value is not None and bytes(value[: len(BYTES_PREFIX)]) == BYTES_PREFIX


def encrypt_text(value: str) -> str:
    return TEXT_PREFIX + _cipher().encrypt(value.encode()).decode("ascii")


def decrypt_text(value: str) -> str:
    if not is_encrypted_text(value):
        return value
    try:
        return _cipher().decrypt(value[len(TEXT_PREFIX):].encode("ascii")).decode()
    except (InvalidToken, UnicodeError):
        raise DecryptError() from None


def encrypt_bytes(value: bytes) -> bytes:
    return BYTES_PREFIX + _cipher().encrypt(bytes(value))


def decrypt_bytes(value: bytes) -> bytes:
    value = bytes(value)
    if not is_encrypted_bytes(value):
        return value
    try:
        return _cipher().decrypt(value[len(BYTES_PREFIX):])
    except InvalidToken:
        raise DecryptError() from None
