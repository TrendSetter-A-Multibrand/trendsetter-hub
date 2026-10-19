"""Группы доступа: access_groups, access_group_permissions, access_group_members (схема trendsetter_hub).

Выполняет db/02_access_groups.sql. В боевой базе скрипт и отметка версии выполняются вручную под doadmin
(db/02_access_groups.sql, затем deploy/stamp_alembic_0002.sql) до слияния кода в main.

Revision ID: 0002
Revises: 0001
"""
import os
from pathlib import Path

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

SQL_FILES = ["02_access_groups.sql"]


def _sql_dir() -> Path:
    # backend/alembic/versions/0002_access_groups.py -> корень репозитория/db
    return Path(os.environ.get("HUB_SQL_DIR") or Path(__file__).resolve().parents[3] / "db")


def upgrade() -> None:
    connection = op.get_bind()
    for name in SQL_FILES:
        script = (_sql_dir() / name).read_text(encoding="utf-8")
        # Скрипт выполняется одним запросом (несколько команд), параметров нет
        connection.connection.cursor().execute(script)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS trendsetter_hub.access_group_members")
    op.execute("DROP TABLE IF EXISTS trendsetter_hub.access_group_permissions")
    op.execute("DROP TABLE IF EXISTS trendsetter_hub.access_groups")
