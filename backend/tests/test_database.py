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


def test_app_role_can_use_access_group_tables(db):
    """Права hub_app на таблицы групп доступа выданы (INSERT, SELECT, UPDATE, DELETE)."""
    db.execute(
        text("INSERT INTO trendsetter_hub.users (email, full_name, password_hash, access_level) VALUES ('g@example.com', 'Г', 'x', 'viewer')")
    )
    user_id = db.execute(text("SELECT id FROM trendsetter_hub.users WHERE email = 'g@example.com'")).scalar_one()
    group_id = db.execute(text("INSERT INTO trendsetter_hub.access_groups (name) VALUES ('Группа') RETURNING id")).scalar_one()
    db.execute(text("INSERT INTO trendsetter_hub.access_group_permissions (group_id, module_id, permission) VALUES (:g, 'warehouse', 'run')"), {"g": group_id})
    db.execute(text("INSERT INTO trendsetter_hub.access_group_members (group_id, user_id) VALUES (:g, :u)"), {"g": group_id, "u": user_id})
    db.execute(text("UPDATE trendsetter_hub.access_groups SET name = 'Группа 2' WHERE id = :g"), {"g": group_id})
    assert db.execute(text("SELECT count(*) FROM trendsetter_hub.access_group_members")).scalar_one() == 1
    db.execute(text("DELETE FROM trendsetter_hub.access_groups WHERE id = :g"), {"g": group_id})
    assert db.execute(text("SELECT count(*) FROM trendsetter_hub.access_group_permissions")).scalar_one() == 0  # CASCADE
    db.rollback()


def test_app_role_can_use_news_tables(db):
    """Права hub_app на таблицы новостей и их последовательности выданы автоматически."""
    item_id = db.execute(text("INSERT INTO trendsetter_hub.news_items (kind, title) VALUES ('news', 'Тест') RETURNING id")).scalar_one()
    user_id = db.execute(
        text("INSERT INTO trendsetter_hub.users (email, full_name, password_hash, access_level) VALUES ('n@example.com', 'Н', 'x', 'employee') RETURNING id")
    ).scalar_one()
    db.execute(text("INSERT INTO trendsetter_hub.news_rsvp (item_id, user_id, answer) VALUES (:i, :u, 'yes')"), {"i": item_id, "u": user_id})
    db.execute(text("UPDATE trendsetter_hub.news_rsvp SET answer = 'no' WHERE item_id = :i"), {"i": item_id})
    db.execute(text("INSERT INTO trendsetter_hub.news_banners (text) VALUES ('Плашка')"))
    assert db.execute(text("SELECT count(*) FROM trendsetter_hub.news_banners WHERE active")).scalar_one() == 1
    db.execute(text("DELETE FROM trendsetter_hub.news_items WHERE id = :i"), {"i": item_id})
    assert db.execute(text("SELECT count(*) FROM trendsetter_hub.news_rsvp")).scalar_one() == 0  # CASCADE
    db.rollback()


def test_alembic_version_in_hub_schema(database):
    import psycopg

    with psycopg.connect(database["db_dsn"]) as conn:
        assert conn.execute("SELECT version_num FROM trendsetter_hub.alembic_version").fetchone() == ("0013",)
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


def test_cli_main_creates_admin_and_prints(engine, clean, client, monkeypatch, capsys):
    """Команда целиком: пароль через getpass, печать результата после закрытия сессии (регресс DetachedInstanceError)."""
    from app.core import cli

    monkeypatch.setattr(cli, "get_engine", lambda: engine)
    monkeypatch.setattr(cli.getpass, "getpass", lambda prompt="": "Strong-pass-1")
    assert cli.main(["create-superadmin", "--email", "cli@example.com", "--name", "Из Консоли"]) == 0
    assert "Администратор создан: cli@example.com" in capsys.readouterr().out
    assert login(client, "cli@example.com", "Strong-pass-1")
    # повтор — понятная ошибка, а не падение
    assert cli.main(["create-superadmin", "--email", "cli@example.com", "--name", "Из Консоли"]) == 1
