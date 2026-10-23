"""HR-досье, отпуска, уведомления и личные права на модуль: user_module_permissions, notifications, hr_*, поле анкеты video_link.

Выполняет db/05_hr_dossier.sql. В боевой базе скрипт и отметка версии выполняются вручную под doadmin
(db/05_hr_dossier.sql, затем deploy/stamp_alembic_0005.sql) до слияния кода в main.

Revision ID: 0005
Revises: 0004
"""
import os
from pathlib import Path

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

SQL_FILES = ["05_hr_dossier.sql"]


def _sql_dir() -> Path:
    return Path(os.environ.get("HUB_SQL_DIR") or Path(__file__).resolve().parents[3] / "db")


def upgrade() -> None:
    connection = op.get_bind()
    for name in SQL_FILES:
        script = (_sql_dir() / name).read_text(encoding="utf-8")
        connection.connection.cursor().execute(script)


def downgrade() -> None:
    # Только новые таблицы (в порядке зависимостей) и строка video_link
    for table in (
        "hr_leave_requests", "hr_leave_adjustments", "hr_employee_sensitive", "hr_employee_files",
        "hr_leave_policies", "notifications", "user_module_permissions",
    ):
        op.execute(f"DROP TABLE IF EXISTS trendsetter_hub.{table}")
    op.execute("DELETE FROM trendsetter_hub.team_form_fields WHERE key = 'video_link'")
