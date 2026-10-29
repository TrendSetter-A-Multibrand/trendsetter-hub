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


def test_app_role_can_use_home_widgets(db):
    """Права hub_app на home_widgets выданы автоматически (ALTER DEFAULT PRIVILEGES); сид-данных нет."""
    assert db.execute(text("SELECT count(*) FROM trendsetter_hub.home_widgets")).scalar_one() == 0
    db.execute(text("INSERT INTO trendsetter_hub.home_widgets (widget_id, position) VALUES ('birthdays', 0)"))
    db.execute(text("UPDATE trendsetter_hub.home_widgets SET enabled = false WHERE widget_id = 'birthdays'"))
    assert db.execute(text("SELECT enabled FROM trendsetter_hub.home_widgets WHERE widget_id = 'birthdays'")).scalar_one() is False
    db.execute(text("DELETE FROM trendsetter_hub.home_widgets WHERE widget_id = 'birthdays'"))
    db.rollback()


def test_home_widgets_script_is_rerunnable(database):
    """0015: повторный прогон SQL не падает; столбец sort и таблица на месте."""
    import psycopg
    from pathlib import Path

    script = (Path(__file__).resolve().parents[2] / "db" / "15_home_widgets.sql").read_text(encoding="utf-8")
    with psycopg.connect(database["db_dsn"], autocommit=True) as conn:
        conn.execute(script)
        conn.execute(script)
        assert conn.execute("SELECT to_regclass('trendsetter_hub.home_widgets')").fetchone()[0] is not None
        assert conn.execute(
            "SELECT 1 FROM information_schema.columns WHERE table_name = 'news_items' AND column_name = 'sort'"
        ).fetchone()


def test_app_role_can_use_holidays_days(db):
    """Права hub_app на holidays_days выданы автоматически; сид-данных нет."""
    assert db.execute(text("SELECT count(*) FROM trendsetter_hub.holidays_days")).scalar_one() == 0
    db.execute(text("INSERT INTO trendsetter_hub.holidays_days (country, day, kind, name) VALUES ('RU', '2027-01-01', 'holiday', 'Новый год')"))
    db.execute(text("UPDATE trendsetter_hub.holidays_days SET kind = 'day_off' WHERE country = 'RU' AND day = '2027-01-01'"))
    assert db.execute(text("SELECT kind FROM trendsetter_hub.holidays_days WHERE country = 'RU'")).scalar_one() == "day_off"
    db.execute(text("DELETE FROM trendsetter_hub.holidays_days WHERE country = 'RU'"))
    db.rollback()


def test_holidays_script_is_rerunnable_and_checks(database):
    """0016: повторный прогон SQL не падает; workday на понедельник и holiday без названия отклоняются ограничениями БД."""
    import psycopg
    from pathlib import Path

    script = (Path(__file__).resolve().parents[2] / "db" / "16_holidays.sql").read_text(encoding="utf-8")
    with psycopg.connect(database["db_dsn"], autocommit=True) as conn:
        conn.execute(script)
        conn.execute(script)
        assert conn.execute("SELECT to_regclass('trendsetter_hub.holidays_days')").fetchone()[0] is not None
        for stmt in (
            "INSERT INTO trendsetter_hub.holidays_days (country, day, kind) VALUES ('RU', '2027-01-04', 'workday')",  # понедельник
            "INSERT INTO trendsetter_hub.holidays_days (country, day, kind) VALUES ('RU', '2027-01-01', 'holiday')",  # без названия
        ):
            with pytest.raises(psycopg.errors.CheckViolation):
                conn.execute(stmt)


def test_app_role_can_use_onboarding_settings(db):
    """Права hub_app на onboarding_settings выданы автоматически (D12); строка одна, общий пароль не задан."""
    row = db.execute(text("SELECT id, password_hash FROM trendsetter_hub.onboarding_settings")).all()
    assert [tuple(r) for r in row] == [(1, None)]
    db.execute(text("UPDATE trendsetter_hub.onboarding_settings SET updated_at = now() WHERE id = 1"))
    db.rollback()


def test_onboarding_script_is_rerunnable_and_checks(database):
    """0017: повторный прогон SQL не падает; оба ограничения D9 на месте и действуют."""
    import psycopg
    from pathlib import Path

    script = (Path(__file__).resolve().parents[2] / "db" / "17_onboarding.sql").read_text(encoding="utf-8")
    with psycopg.connect(database["db_dsn"], autocommit=True) as conn:
        conn.execute(script)
        conn.execute(script)
        names = {r[0] for r in conn.execute("SELECT conname FROM pg_constraint WHERE conrelid = 'trendsetter_hub.users'::regclass")}
        assert {"users_level_or_onboarding_check", "users_must_change_password_check"} <= names
        assert conn.execute("SELECT count(*) FROM trendsetter_hub.onboarding_settings").fetchone() == (1,)
        for stmt in (
            "INSERT INTO trendsetter_hub.users (email, full_name, password_hash, access_level, onboarding) VALUES ('ob1@example.com', 'А', 'x', NULL, false)",
            "INSERT INTO trendsetter_hub.users (email, full_name, password_hash, access_level, must_change_password) VALUES ('ob2@example.com', 'Б', 'x', 'viewer', true)",
        ):
            with pytest.raises(psycopg.errors.CheckViolation):
                conn.execute(stmt)


def test_onboarding_downgrade_disables_unleveled_users(database):
    """alembic downgrade 0016: учётка без уровня отключается и получает viewer; затем upgrade обратно."""
    import os
    import subprocess
    import sys

    import psycopg

    from tests.conftest import BACKEND, _replace_db

    env = {**os.environ, "HUB_MIGRATION_DATABASE_URL": _replace_db(database["admin_dsn"], database["name"]).replace("postgresql://", "postgresql+psycopg://", 1)}

    def alembic(*args):
        subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND, env=env, check=True)

    with psycopg.connect(database["db_dsn"], autocommit=True) as conn:
        user_id = conn.execute(
            "INSERT INTO trendsetter_hub.users (email, full_name, password_hash, access_level, onboarding, must_change_password) "
            "VALUES ('down@example.com', 'Д', 'x', NULL, true, true) RETURNING id"
        ).fetchone()[0]
        try:
            alembic("downgrade", "0016")
            assert conn.execute("SELECT is_active, access_level FROM trendsetter_hub.users WHERE id = %s", (user_id,)).fetchone() == (False, "viewer")
            assert conn.execute("SELECT version_num FROM trendsetter_hub.alembic_version").fetchone() == ("0016",)
            assert conn.execute("SELECT to_regclass('trendsetter_hub.onboarding_settings')").fetchone()[0] is None
        finally:
            alembic("upgrade", "head")
            conn.execute("DELETE FROM trendsetter_hub.users WHERE id = %s", (user_id,))
        assert conn.execute("SELECT version_num FROM trendsetter_hub.alembic_version").fetchone() == ("0017",)
        assert conn.execute("SELECT count(*) FROM trendsetter_hub.onboarding_settings").fetchone() == (1,)


def test_alembic_version_in_hub_schema(database):
    import psycopg

    with psycopg.connect(database["db_dsn"]) as conn:
        assert conn.execute("SELECT version_num FROM trendsetter_hub.alembic_version").fetchone() == ("0017",)
        assert conn.execute("SELECT to_regclass('public.alembic_version')").fetchone() == (None,)


def _status_checks(conn):
    return conn.execute(
        "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint "
        "WHERE conrelid = 'trendsetter_hub.news_items'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%status%'"
    ).fetchall()


def test_news_moderation_constraints_and_rerun(database):
    """0014: старое CHECK статуса снято (T-NM1), новые есть, повторный прогон SQL не падает и ничего не меняет."""
    import psycopg
    from pathlib import Path

    script = (Path(__file__).resolve().parents[2] / "db" / "14_news_moderation.sql").read_text(encoding="utf-8")
    with psycopg.connect(database["db_dsn"], autocommit=True) as conn:
        before = _status_checks(conn)
        conn.execute(script)
        conn.execute(script)
        assert _status_checks(conn) == before
        names = {name for name, _ in before}
        assert "news_items_status_v2_check" in names
        assert not [n for n, d in before if "'published'" in d and "'pending'" not in d]
        all_names = {r[0] for r in conn.execute("SELECT conname FROM pg_constraint WHERE conrelid = 'trendsetter_hub.news_items'::regclass")}
        assert {"news_items_review_comment_check", "news_items_proposal_check"} <= all_names
        indexes = {r[0] for r in conn.execute("SELECT indexname FROM pg_indexes WHERE tablename = 'news_items'")}
        assert {"news_items_author_idx", "news_items_pending_idx"} <= indexes


def test_news_moderation_downgrade_keeps_pending_as_draft(database):
    """alembic downgrade 0013 при наличии pending-строки: строка становится draft; затем upgrade обратно."""
    import os
    import subprocess
    import sys

    import psycopg

    from tests.conftest import BACKEND, _replace_db

    env = {**os.environ, "HUB_MIGRATION_DATABASE_URL": _replace_db(database["admin_dsn"], database["name"]).replace("postgresql://", "postgresql+psycopg://", 1)}

    def alembic(*args):
        subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND, env=env, check=True)

    with psycopg.connect(database["db_dsn"], autocommit=True) as conn:
        item_id = conn.execute(
            "INSERT INTO trendsetter_hub.news_items (kind, title, status, submitted_at) VALUES ('news', 'Тест', 'pending', now()) RETURNING id"
        ).fetchone()[0]
        try:
            alembic("downgrade", "0013")
            assert conn.execute("SELECT status FROM trendsetter_hub.news_items WHERE id = %s", (item_id,)).fetchone() == ("draft",)
            assert conn.execute("SELECT version_num FROM trendsetter_hub.alembic_version").fetchone() == ("0013",)
            assert not conn.execute(
                "SELECT 1 FROM information_schema.columns WHERE table_name = 'news_items' AND column_name = 'submitted_at'"
            ).fetchone()
        finally:
            alembic("upgrade", "head")
            conn.execute("DELETE FROM trendsetter_hub.news_items WHERE id = %s", (item_id,))
        assert conn.execute("SELECT version_num FROM trendsetter_hub.alembic_version").fetchone() == ("0017",)
        assert "news_items_status_v2_check" in {name for name, _ in _status_checks(conn)}


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
