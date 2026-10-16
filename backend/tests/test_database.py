"""Проверки самой базы: права hub_app, схема, CLI. Приложение подключается как hub_app, как на сервере."""
import pytest
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError

from app.core.cli import create_superadmin
from tests.conftest import login


def test_app_role_cannot_change_structure(db):
    with pytest.raises(ProgrammingError):
        db.execute(text("CREATE TABLE trendsetter_hub.hack (id int)"))
    db.rollback()
    with pytest.raises(ProgrammingError):
        db.execute(text("DROP TABLE trendsetter_hub.users"))
    db.rollback()


def test_app_role_can_use_warehouse_objects(db):
    """Права на таблицы, последовательности, представление и функцию модуля «Склад» выданы автоматически."""
    db.execute(text("INSERT INTO trendsetter_hub.warehouse_receipts (name) VALUES ('Тест')"))
    assert db.execute(text("SELECT trendsetter_hub.warehouse_next_box_number('05')")).scalar_one() == 1
    assert db.execute(text("SELECT count(*) FROM trendsetter_hub.warehouse_receipt_summary")).scalar_one() == 1
    db.rollback()


def test_alembic_version_in_hub_schema(database):
    import psycopg

    with psycopg.connect(database["db_dsn"]) as conn:
        assert conn.execute("SELECT version_num FROM trendsetter_hub.alembic_version").fetchone() == ("0001",)
        assert conn.execute("SELECT to_regclass('public.alembic_version')").fetchone() == (None,)


def test_create_superadmin(db, client):
    user = create_superadmin(db, "root@example.com", "Главный Админ", "Strong-pass-1")
    assert user.access_level == "admin"
    assert login(client, "root@example.com", "Strong-pass-1")
    with pytest.raises(ValueError):
        create_superadmin(db, "ROOT@example.com", "Дубль", "Strong-pass-1")
    with pytest.raises(ValueError):
        create_superadmin(db, "x@example.com", "Имя", "short")
    with pytest.raises(ValueError):
        create_superadmin(db, "bad", "Имя", "Strong-pass-1")
