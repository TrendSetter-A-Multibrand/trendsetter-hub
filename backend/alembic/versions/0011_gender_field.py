"""Анкета: системное поле «Пол» (team_form_fields.key = 'gender').

Выполняет db/11_gender_field.sql. В боевой базе скрипт и отметка версии выполняются вручную под doadmin
(db/11_gender_field.sql, затем deploy/stamp_alembic_0011.sql) до слияния кода в main.

Revision ID: 0011
Revises: 0010
"""
import os
from pathlib import Path

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None

SQL_FILES = ["11_gender_field.sql"]


def _sql_dir() -> Path:
    return Path(os.environ.get("HUB_SQL_DIR") or Path(__file__).resolve().parents[3] / "db")


def upgrade() -> None:
    connection = op.get_bind()
    for name in SQL_FILES:
        script = (_sql_dir() / name).read_text(encoding="utf-8")
        connection.connection.cursor().execute(script)


def downgrade() -> None:
    op.execute("DELETE FROM trendsetter_hub.team_form_fields WHERE key = 'gender'")
