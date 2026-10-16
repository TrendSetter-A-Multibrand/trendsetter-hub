"""Базовая ревизия: ядро хаба и модуль «Склад» (схема trendsetter_hub).

Выполняет SQL-файлы из db/ — единый источник правды для структуры. В боевой базе эти скрипты уже
выполнены вручную в pgAdmin/DBeaver, поэтому там выполняется только `alembic stamp head`, а не upgrade.
Перед запуском на чистой базе должна существовать роль hub_app (скрипты выдают ей права).

Revision ID: 0001
Revises:
"""
import os
from pathlib import Path

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

SQL_FILES = ["01_core_hub.sql", "modules/warehouse/001_warehouse.sql"]


def _sql_dir() -> Path:
    # backend/alembic/versions/0001_baseline.py -> корень репозитория/db
    return Path(os.environ.get("HUB_SQL_DIR") or Path(__file__).resolve().parents[3] / "db")


def upgrade() -> None:
    connection = op.get_bind()
    for name in SQL_FILES:
        script = (_sql_dir() / name).read_text(encoding="utf-8")
        # Скрипт выполняется одним запросом (несколько команд), параметров нет
        connection.connection.cursor().execute(script)


def downgrade() -> None:
    raise NotImplementedError("Откат базовой ревизии не поддерживается: удаление схемы уничтожит данные")
