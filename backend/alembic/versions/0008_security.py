"""Безопасность: users.token_version и индексы журнала.

Выполняет db/08_security.sql. В боевой базе скрипт и отметка версии выполняются вручную под doadmin
(db/08_security.sql, затем deploy/stamp_alembic_0008.sql) до слияния кода в main.

Revision ID: 0008
Revises: 0007
"""
import os
from pathlib import Path

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

SQL_FILES = ["08_security.sql"]


def _sql_dir() -> Path:
    return Path(os.environ.get("HUB_SQL_DIR") or Path(__file__).resolve().parents[3] / "db")


def upgrade() -> None:
    connection = op.get_bind()
    for name in SQL_FILES:
        script = (_sql_dir() / name).read_text(encoding="utf-8")
        connection.connection.cursor().execute(script)


def downgrade() -> None:
    # Только новые индексы и столбец
    op.execute("DROP INDEX IF EXISTS trendsetter_hub.audit_log_person_idx")
    op.execute("DROP INDEX IF EXISTS trendsetter_hub.audit_log_action_at_idx")
    op.execute("ALTER TABLE trendsetter_hub.users DROP COLUMN IF EXISTS token_version")
