"""Новости: столбец news_items.color (цвет записи).

Выполняет db/10_news_color.sql. В боевой базе скрипт и отметка версии выполняются вручную под doadmin
(db/10_news_color.sql, затем deploy/stamp_alembic_0010.sql) до слияния кода в main.

Revision ID: 0010
Revises: 0009
"""
import os
from pathlib import Path

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

SQL_FILES = ["10_news_color.sql"]


def _sql_dir() -> Path:
    return Path(os.environ.get("HUB_SQL_DIR") or Path(__file__).resolve().parents[3] / "db")


def upgrade() -> None:
    connection = op.get_bind()
    for name in SQL_FILES:
        script = (_sql_dir() / name).read_text(encoding="utf-8")
        connection.connection.cursor().execute(script)


def downgrade() -> None:
    op.execute("ALTER TABLE trendsetter_hub.news_items DROP CONSTRAINT IF EXISTS news_items_color_check")
    op.execute("ALTER TABLE trendsetter_hub.news_items DROP COLUMN IF EXISTS color")
