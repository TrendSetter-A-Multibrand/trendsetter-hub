"""Новости: предложка и модерация (статусы pending / needs_changes / rejected, сведения о проверке).

Выполняет db/14_news_moderation.sql. В боевой базе скрипт и отметка версии выполняются вручную под doadmin
(db/14_news_moderation.sql, затем deploy/stamp_alembic_0014.sql) до слияния кода в main.

Revision ID: 0014
Revises: 0013
"""
import os
from pathlib import Path

from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None

SQL_FILES = ["14_news_moderation.sql"]

T = "trendsetter_hub.news_items"


def _sql_dir() -> Path:
    return Path(os.environ.get("HUB_SQL_DIR") or Path(__file__).resolve().parents[3] / "db")


def upgrade() -> None:
    connection = op.get_bind()
    for name in SQL_FILES:
        script = (_sql_dir() / name).read_text(encoding="utf-8")
        connection.connection.cursor().execute(script)


def downgrade() -> None:
    op.execute(f"UPDATE {T} SET status = 'draft' WHERE status IN ('pending', 'needs_changes', 'rejected')")
    for name in ("news_items_status_v2_check", "news_items_review_comment_check", "news_items_proposal_check"):
        op.execute(f"ALTER TABLE {T} DROP CONSTRAINT IF EXISTS {name}")
    op.execute("DROP INDEX IF EXISTS trendsetter_hub.news_items_author_idx")
    op.execute("DROP INDEX IF EXISTS trendsetter_hub.news_items_pending_idx")
    op.execute(f"ALTER TABLE {T} ADD CONSTRAINT news_items_status_check CHECK (status IN ('draft', 'published'))")
    for column in ("submitted_at", "review_comment", "reviewed_by", "reviewed_at"):
        op.execute(f"ALTER TABLE {T} DROP COLUMN IF EXISTS {column}")
