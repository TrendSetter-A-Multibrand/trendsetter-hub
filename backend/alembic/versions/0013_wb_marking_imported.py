"""WB «Маркировка»: wb_marking_imported (выведенные вне хаба коды из Excel).

Выполняет db/modules/wb/002_wb_marking_imported.sql. В боевой базе скрипт и отметка версии выполняются вручную под doadmin
(db/modules/wb/002_wb_marking_imported.sql, затем deploy/stamp_alembic_0013.sql) до слияния кода в main.

Revision ID: 0013
Revises: 0012
"""
import os
from pathlib import Path

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None

SQL_FILES = ["modules/wb/002_wb_marking_imported.sql"]


def _sql_dir() -> Path:
    return Path(os.environ.get("HUB_SQL_DIR") or Path(__file__).resolve().parents[3] / "db")


def upgrade() -> None:
    connection = op.get_bind()
    for name in SQL_FILES:
        script = (_sql_dir() / name).read_text(encoding="utf-8")
        connection.connection.cursor().execute(script)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS trendsetter_hub.wb_marking_imported")
