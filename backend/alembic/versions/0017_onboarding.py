"""Онбординг нового сотрудника (флаги в users, таблица onboarding_settings).

Выполняет db/17_onboarding.sql. В боевой базе скрипт и отметка версии выполняются вручную под doadmin
(db/17_onboarding.sql, затем deploy/stamp_alembic_0017.sql) до слияния кода в main.

Revision ID: 0017
Revises: 0016
"""
import os
from pathlib import Path

from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None

SQL_FILES = ["17_onboarding.sql"]


def _sql_dir() -> Path:
    return Path(os.environ.get("HUB_SQL_DIR") or Path(__file__).resolve().parents[3] / "db")


def upgrade() -> None:
    connection = op.get_bind()
    for name in SQL_FILES:
        script = (_sql_dir() / name).read_text(encoding="utf-8")
        connection.connection.cursor().execute(script)


def downgrade() -> None:
    # Все учётки на онбординге отключаются (в том числе те, кому админ выдал уровень через PATCH); без уровня получают viewer
    op.execute(
        "UPDATE trendsetter_hub.users SET is_active = false, access_level = COALESCE(access_level, 'viewer') "
        "WHERE onboarding OR access_level IS NULL"
    )
    op.execute("ALTER TABLE trendsetter_hub.users DROP CONSTRAINT IF EXISTS users_must_change_password_check")
    op.execute("ALTER TABLE trendsetter_hub.users DROP CONSTRAINT IF EXISTS users_level_or_onboarding_check")
    op.execute("ALTER TABLE trendsetter_hub.users DROP COLUMN IF EXISTS must_change_password")
    op.execute("ALTER TABLE trendsetter_hub.users DROP COLUMN IF EXISTS onboarding")
    op.execute("ALTER TABLE trendsetter_hub.users DROP COLUMN IF EXISTS onboarding_expires_at")
    op.execute("DROP TABLE IF EXISTS trendsetter_hub.onboarding_settings")
    op.execute("ALTER TABLE trendsetter_hub.users ALTER COLUMN access_level SET NOT NULL")
