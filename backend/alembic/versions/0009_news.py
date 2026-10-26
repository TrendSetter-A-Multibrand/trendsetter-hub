"""Новости компании: news_items, news_rsvp, news_banners.

Выполняет db/09_news.sql. В боевой базе скрипт и отметка версии выполняются вручную под doadmin
(db/09_news.sql, затем deploy/stamp_alembic_0009.sql) до слияния кода в main.

Revision ID: 0009
Revises: 0008
"""
import os
from pathlib import Path

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None

SQL_FILES = ["09_news.sql"]


def _sql_dir() -> Path:
    return Path(os.environ.get("HUB_SQL_DIR") or Path(__file__).resolve().parents[3] / "db")


def upgrade() -> None:
    connection = op.get_bind()
    for name in SQL_FILES:
        script = (_sql_dir() / name).read_text(encoding="utf-8")
        connection.connection.cursor().execute(script)


def downgrade() -> None:
    # Только таблицы новостей; права модуля news (user_module_permissions, access_group_permissions) не трогаем
    op.execute("DROP TABLE IF EXISTS trendsetter_hub.news_rsvp")
    op.execute("DROP TABLE IF EXISTS trendsetter_hub.news_items")
    op.execute("DROP TABLE IF EXISTS trendsetter_hub.news_banners")
