"""Обратная связь сотрудников (таблица feedback_messages).

Выполняет db/18_feedback.sql. В боевой базе скрипт и отметка версии выполняются вручную под doadmin
(db/18_feedback.sql, затем deploy/stamp_alembic_0018.sql) до слияния кода в main.

Revision ID: 0018
Revises: 0017
"""
import os
from pathlib import Path

from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None

SQL_FILES = ["18_feedback.sql"]


def _sql_dir() -> Path:
    return Path(os.environ.get("HUB_SQL_DIR") or Path(__file__).resolve().parents[3] / "db")


def upgrade() -> None:
    connection = op.get_bind()
    for name in SQL_FILES:
        script = (_sql_dir() / name).read_text(encoding="utf-8")
        connection.connection.cursor().execute(script)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS trendsetter_hub.feedback_messages")
