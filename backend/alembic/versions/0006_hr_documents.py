"""HR: документы сотрудника (hr_documents, hr_document_files).

Выполняет db/06_hr_documents.sql. В боевой базе скрипт и отметка версии выполняются вручную под doadmin
(db/06_hr_documents.sql, затем deploy/stamp_alembic_0006.sql) до слияния кода в main.

Revision ID: 0006
Revises: 0005
"""
import os
from pathlib import Path

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

SQL_FILES = ["06_hr_documents.sql"]


def _sql_dir() -> Path:
    return Path(os.environ.get("HUB_SQL_DIR") or Path(__file__).resolve().parents[3] / "db")


def upgrade() -> None:
    connection = op.get_bind()
    for name in SQL_FILES:
        script = (_sql_dir() / name).read_text(encoding="utf-8")
        connection.connection.cursor().execute(script)


def downgrade() -> None:
    # Только новые таблицы (в порядке зависимостей)
    for table in ("hr_document_files", "hr_documents"):
        op.execute(f"DROP TABLE IF EXISTS trendsetter_hub.{table}")
