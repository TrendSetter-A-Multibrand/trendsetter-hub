"""Отдел HR и привязка модуля hr (модуль team — для всех, без привязки).

Выполняет db/03_hr_team_modules.sql. В боевой базе скрипт и отметка версии выполняются вручную под doadmin
(db/03_hr_team_modules.sql, затем deploy/stamp_alembic_0003.sql) до слияния кода в main.

Revision ID: 0003
Revises: 0002
"""
import os
from pathlib import Path

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

SQL_FILES = ["03_hr_team_modules.sql"]


def _sql_dir() -> Path:
    return Path(os.environ.get("HUB_SQL_DIR") or Path(__file__).resolve().parents[3] / "db")


def upgrade() -> None:
    connection = op.get_bind()
    for name in SQL_FILES:
        script = (_sql_dir() / name).read_text(encoding="utf-8")
        connection.connection.cursor().execute(script)


def downgrade() -> None:
    op.execute("DELETE FROM trendsetter_hub.module_departments WHERE module_id = 'hr'")
    op.execute("DELETE FROM trendsetter_hub.departments WHERE code = 'hr'")
