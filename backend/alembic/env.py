"""Миграции выполняются под владельцем схемы (doadmin) — строка HUB_MIGRATION_DATABASE_URL.
Приложение (hub_app) прав на изменение структуры не имеет. Таблица версий лежит в схеме trendsetter_hub,
чтобы не трогать public общей базы defaultdb."""
import os

from alembic import context
from sqlalchemy import create_engine, text

SCHEMA = "trendsetter_hub"

config = context.config


def run_migrations() -> None:
    url = os.environ.get("HUB_MIGRATION_DATABASE_URL")
    if not url:
        raise RuntimeError("HUB_MIGRATION_DATABASE_URL не задан")
    engine = create_engine(url)
    with engine.connect() as connection:
        # схема нужна до создания таблицы версий
        connection.execute(text(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}"))
        connection.commit()
        context.configure(connection=connection, target_metadata=None, version_table_schema=SCHEMA)
        with context.begin_transaction():
            context.run_migrations()
        connection.commit()


run_migrations()
