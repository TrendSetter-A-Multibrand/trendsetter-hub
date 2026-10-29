"""Онбординг нового сотрудника: самосоздание учётки по общему стартовому паролю, завершение онбординга (docs/TZ-onboarding.md).

Секреты сравниваются только через bcrypt (security.verify_password), никогда через ==. Пароли и хэши не пишутся ни в журнал, ни в логи.
Ядро не импортирует модули: modules/team импортирует этот файл, а не наоборот.
"""
import re
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import messages as m
from app.core.audit import log_action
from app.core.models import Department, OnboardingSettings, User, UserDepartment
from app.core.security import hash_password, verify_password

SELF_REGISTER_DOMAINS = ("trendsettercrew.com",)  # D1: домены — кортеж констант (второй домен — правка одной строки); редактора нет
ONBOARDING_TTL_DAYS = 14
SELF_REGISTER_DAILY_LIMIT = 20
HR_LEVELS = ("employee", "viewer", "superuser")  # admin выдаёт только администратор
SELF_REGISTER_LOCK = 70_007_002  # ключ advisory-блокировки; рядом с DAILY_JOBS_LOCK = 70_007_001
SHARED_PASSWORD_MIN_LEN = 12
SELF_REGISTER_ACTION = "core.onboarding_self_register"

EMAIL_MAX_LEN = 254
LOCAL_PART_RE = re.compile(r"[a-z0-9._-]{1,64}")


def _now() -> datetime:
    return datetime.now(UTC)


def settings_row(session: Session) -> OnboardingSettings | None:
    """Строка id = 1. Нет строки = самосоздание выключено, не ошибка."""
    return session.get(OnboardingSettings, 1)


def self_register_email_ok(email_key: str) -> bool:
    """D2: почта в нижнем регистре; одна «@», локальная часть [a-z0-9._-]{1,64}, домен в точности из SELF_REGISTER_DOMAINS (поддомены не проходят)."""
    if len(email_key) > EMAIL_MAX_LEN or email_key.count("@") != 1:
        return False
    local, domain = email_key.split("@")
    return domain in SELF_REGISTER_DOMAINS and LOCAL_PART_RE.fullmatch(local) is not None


def shared_eligible(user: User) -> bool:
    """Общий пароль применим к учётке: активна, на онбординге, пароль ещё не менялся, срок не истёк. bcrypt не вызывает."""
    return bool(
        user.is_active
        and user.onboarding
        and user.must_change_password
        and user.onboarding_expires_at is not None
        and user.onboarding_expires_at > _now()
    )


def shared_password_ok(session: Session, user: User, password: str) -> bool:
    """Только для change-password: вход считает свои две проверки bcrypt сам (D3)."""
    if not shared_eligible(user):
        return False
    row = settings_row(session)
    return bool(row is not None and row.password_hash and verify_password(password, row.password_hash))


def self_register_count_24h(session: Session) -> int:
    return session.execute(
        text("SELECT count(*) FROM trendsetter_hub.audit_log WHERE action = :a AND at > now() - interval '24 hours'"),
        {"a": SELF_REGISTER_ACTION},
    ).scalar_one()


def self_register(session: Session, email_key: str) -> User | None:
    """Создаёт учётку новичка (без уровня, без отделов). 429 ONBOARDING_LIMIT при исчерпанном суточном лимите.
    None — почта успела появиться (гонка): вызывающий отвечает обычным 401. Коммитит вызывающий код (замок снимается с транзакцией)."""
    session.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": SELF_REGISTER_LOCK})
    if self_register_count_24h(session) >= SELF_REGISTER_DAILY_LIMIT:
        raise HTTPException(429, m.ONBOARDING_LIMIT)
    user = User(
        email=email_key,
        full_name=email_key.split("@")[0][:120],  # временное имя: при одобрении заменится именем из анкеты
        password_hash=hash_password(secrets.token_urlsafe(32)),  # личный пароль неизвестен никому до смены
        access_level=None,
        is_active=True,
        must_change_password=True,
        onboarding=True,
        onboarding_expires_at=_now() + timedelta(days=ONBOARDING_TTL_DAYS),
    )
    session.add(user)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        return None
    log_action(session, user.id, SELF_REGISTER_ACTION)
    return user


def validate_finish(session: Session, access_level: str | None, department_ids: list[int], allowed_levels: tuple[str, ...]) -> list[int]:
    """Проверка уровня и отделов без записи (422 UNKNOWN_LEVEL / UNKNOWN_DEPARTMENT); возвращает отсортированные уникальные id отделов."""
    if access_level not in allowed_levels:
        raise HTTPException(422, m.UNKNOWN_LEVEL)
    ids = sorted(set(department_ids))
    if any(not 0 < i < 32768 for i in ids):  # id отделов — smallint: иное значение — несуществующий отдел, а не ошибка БД
        raise HTTPException(422, m.UNKNOWN_DEPARTMENT)
    found = set(session.scalars(select(Department.id).where(Department.id.in_(ids))).all()) if ids else set()
    if set(ids) != found:
        raise HTTPException(422, m.UNKNOWN_DEPARTMENT)
    return ids


def finish_onboarding(session: Session, user: User, access_level: str | None, department_ids: list[int], allowed_levels: tuple[str, ...]) -> None:
    """Снимает онбординг: ставит уровень и заменяет отделы. Коммит — на вызывающем."""
    ids = validate_finish(session, access_level, department_ids, allowed_levels)
    user.access_level = access_level
    user.onboarding = False
    session.query(UserDepartment).filter(UserDepartment.user_id == user.id).delete()
    for department_id in ids:
        session.add(UserDepartment(user_id=user.id, department_id=department_id))
