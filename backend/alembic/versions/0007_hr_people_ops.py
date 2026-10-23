"""HR: напоминания, история, оборудование, чек-листы, годовой график отпусков, свои документы.

Выполняет db/07_hr_people_ops.sql. В боевой базе скрипт и отметка версии выполняются вручную под doadmin
(db/07_hr_people_ops.sql, затем deploy/stamp_alembic_0007.sql) до слияния кода в main.

Revision ID: 0007
Revises: 0006
"""
import os
from pathlib import Path

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

SQL_FILES = ["07_hr_people_ops.sql"]


def _sql_dir() -> Path:
    return Path(os.environ.get("HUB_SQL_DIR") or Path(__file__).resolve().parents[3] / "db")


def upgrade() -> None:
    connection = op.get_bind()
    for name in SQL_FILES:
        script = (_sql_dir() / name).read_text(encoding="utf-8")
        connection.connection.cursor().execute(script)


def downgrade() -> None:
    # Только новые таблицы (в порядке зависимостей) и два новых столбца
    for table in (
        "hr_leave_plans", "hr_checklist_items", "hr_checklists", "hr_checklist_template_items", "hr_checklist_templates",
        "hr_equipment", "hr_employee_history", "hr_reminder_log",
    ):
        op.execute(f"DROP TABLE IF EXISTS trendsetter_hub.{table}")
    op.execute("ALTER TABLE trendsetter_hub.hr_documents DROP COLUMN IF EXISTS visible_to_employee")
    op.execute("ALTER TABLE trendsetter_hub.hr_employee_files DROP COLUMN IF EXISTS birthday_hidden")
