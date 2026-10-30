"""Виджеты главной (таблица home_widgets) и порядок закреплённых новостей (news_items.sort).

Выполняет db/15_home_widgets.sql. В боевой базе скрипт и отметка версии выполняются вручную под doadmin
(db/15_home_widgets.sql, затем deploy/stamp_alembic_0015.sql) до слияния кода в main.

Revision ID: 0015
Revises: 0014
"""
import os
from pathlib import Path

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None

SQL_FILES = ["15_home_widgets.sql"]


def _sql_dir() -> Path:
    return Path(os.environ.get("HUB_SQL_DIR") or Path(__file__).resolve().parents[3] / "db")


def upgrade() -> None:
    connection = op.get_bind()
    for name in SQL_FILES:
        script = (_sql_dir() / name).read_text(encoding="utf-8")
        connection.connection.cursor().execute(script)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS trendsetter_hub.home_widgets")
    op.execute("ALTER TABLE trendsetter_hub.news_items DROP COLUMN IF EXISTS sort")
