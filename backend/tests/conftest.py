"""Тесты работают на временной базе: схема создаётся ревизиями Alembic под администратором (как при деплое),
а приложение подключается как hub_app — так видно любую нехватку прав (GRANT)."""
import os
import subprocess
import sys
import uuid
from pathlib import Path

import psycopg
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from psycopg import sql

BACKEND = Path(__file__).resolve().parents[1]
APP_ROLE_PASSWORD = "dev-only-app-password"  # тот же, что в docker-compose.yml: роль hub_app общая для разработки и тестов
ADMIN_PASSWORD_IN_TESTS = "Pass-12345"

# Окружение должно быть задано до импорта приложения
os.environ.setdefault("HUB_JWT_SECRET", "test-only-jwt-secret-0123456789-abcdefgh")
os.environ.setdefault("HUB_PII_KEY", Fernet.generate_key().decode())  # тестовый ключ шифрования ПДн
os.environ.setdefault("HUB_DATABASE_URL", "postgresql+psycopg://placeholder@localhost/placeholder")


def _admin_dsn() -> str:
    dsn = os.environ.get("HUB_TEST_ADMIN_DSN")
    if not dsn:
        pytest.skip("HUB_TEST_ADMIN_DSN не задан (тесты запускаются в docker compose)")
    return dsn


def _replace_db(dsn: str, dbname: str) -> str:
    # postgresql://user:pass@host:port/postgres -> .../dbname
    return dsn.rsplit("/", 1)[0] + "/" + dbname


@pytest.fixture(scope="session")
def database():
    admin_dsn = _admin_dsn()
    name = "hub_test_" + uuid.uuid4().hex[:8]
    with psycopg.connect(admin_dsn, autocommit=True) as conn:
        exists = conn.execute("SELECT 1 FROM pg_roles WHERE rolname = 'hub_app'").fetchone()
        if not exists:
            conn.execute(sql.SQL("CREATE ROLE hub_app LOGIN PASSWORD {}").format(sql.Literal(APP_ROLE_PASSWORD)))
        else:
            conn.execute(sql.SQL("ALTER ROLE hub_app PASSWORD {}").format(sql.Literal(APP_ROLE_PASSWORD)))
        conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))

    migration_url = _replace_db(admin_dsn, name).replace("postgresql://", "postgresql+psycopg://", 1)
    env = {**os.environ, "HUB_MIGRATION_DATABASE_URL": migration_url}
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND, env=env, check=True)

    host_part = admin_dsn.split("@", 1)[1].rsplit("/", 1)[0]
    app_url = f"postgresql+psycopg://hub_app:{APP_ROLE_PASSWORD}@{host_part}/{name}"
    yield {"name": name, "app_url": app_url, "admin_dsn": admin_dsn, "db_dsn": _replace_db(admin_dsn, name)}

    with psycopg.connect(admin_dsn, autocommit=True) as conn:
        conn.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name)))


@pytest.fixture(scope="session")
def engine(database):
    from sqlalchemy import create_engine

    eng = create_engine(database["app_url"])
    yield eng
    eng.dispose()


@pytest.fixture()
def clean(database):
    """Пользователи, привязки, журнал и данные склада очищаются перед каждым тестом (отделы и модули — стартовые)."""
    from app.core.routes_auth import reset_password_attempts

    reset_password_attempts()  # id пользователей после TRUNCATE начинаются с 1: счётчик попыток не должен «переезжать» между тестами
    with psycopg.connect(database["db_dsn"], autocommit=True) as conn:
        conn.execute(
            "TRUNCATE trendsetter_hub.audit_log, trendsetter_hub.access_groups, trendsetter_hub.user_departments, trendsetter_hub.users, "
            "trendsetter_hub.warehouse_receipts, trendsetter_hub.warehouse_box_counters, trendsetter_hub.warehouse_pallet_pointers "
            "RESTART IDENTITY CASCADE"
        )
        # team_people/photos/submissions очищены каскадом от users; конструктор полей возвращается к стартовому набору (скрипт идемпотентен)
        conn.execute("DELETE FROM trendsetter_hub.team_form_fields")
        conn.execute((BACKEND.parent / "db" / "04_team.sql").read_text(encoding="utf-8"))
        # нормы отпуска возвращаются к стартовым; поле video_link — как после миграции 0005
        conn.execute("DELETE FROM trendsetter_hub.hr_leave_policies")
        conn.execute((BACKEND.parent / "db" / "05_hr_dossier.sql").read_text(encoding="utf-8"))
        conn.execute((BACKEND.parent / "db" / "11_gender_field.sql").read_text(encoding="utf-8"))  # поле «Пол» — как после миграции 0011
        # напоминания (без FK на users) и шаблоны чек-листов возвращаются к стартовым (скрипт идемпотентен)
        conn.execute("TRUNCATE trendsetter_hub.hr_reminder_log, trendsetter_hub.hr_checklist_templates RESTART IDENTITY CASCADE")
        conn.execute((BACKEND.parent / "db" / "07_hr_people_ops.sql").read_text(encoding="utf-8"))
        conn.execute("DELETE FROM trendsetter_hub.departments WHERE code NOT IN ('purchasing','warehouse','wb','analytics','pricing','hr')")


@pytest.fixture()
def client(engine, clean):
    from sqlalchemy.orm import sessionmaker

    from app.db.database import get_session
    from app.main import app

    factory = sessionmaker(bind=engine, expire_on_commit=False)

    def override():
        with factory() as session:
            yield session

    app.dependency_overrides[get_session] = override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def db(engine, clean):
    from sqlalchemy.orm import Session

    with Session(engine) as session:
        yield session


def make_user(db, email, level, department_ids=(), password=ADMIN_PASSWORD_IN_TESTS, active=True, name="Тест Тестов"):
    from app.core.models import User, UserDepartment
    from app.core.security import hash_password

    user = User(email=email, full_name=name, access_level=level, password_hash=hash_password(password), is_active=active)
    db.add(user)
    db.flush()
    for d in department_ids:
        db.add(UserDepartment(user_id=user.id, department_id=d))
    db.commit()
    return user


def login(client, email, password=ADMIN_PASSWORD_IN_TESTS) -> dict:
    r = client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}
