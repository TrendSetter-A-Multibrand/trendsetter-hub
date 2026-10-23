"""Модуль «Карта команды»: таблицы team_* и справочник направлений (людей загружает команда app.modules.team.seed).

Выполняет db/04_team.sql. В боевой базе скрипт и отметка версии выполняются вручную под doadmin
(db/04_team.sql, затем deploy/stamp_alembic_0004.sql) до слияния кода в main.

Revision ID: 0004
Revises: 0003
"""
import os
from pathlib import Path

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

SQL_FILES = ["04_team.sql"]


def _sql_dir() -> Path:
    return Path(os.environ.get("HUB_SQL_DIR") or Path(__file__).resolve().parents[3] / "db")


def upgrade() -> None:
    connection = op.get_bind()
    for name in SQL_FILES:
        script = (_sql_dir() / name).read_text(encoding="utf-8")
        connection.connection.cursor().execute(script)


def downgrade() -> None:
    # Только таблицы team_*, в порядке зависимостей
    for table in ("team_submissions", "team_photos", "team_people", "team_form_fields", "team_directions"):
        op.execute(f"DROP TABLE IF EXISTS trendsetter_hub.{table}")
