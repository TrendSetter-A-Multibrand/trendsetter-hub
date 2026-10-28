"""Отдельное подключение к отчётам WB в схеме public (api_wb_*). Только чтение: пользователь HUB_WB_DATABASE_URL — с правом SELECT,
каждый запрос — в транзакции READ ONLY с ограничением времени. Таблицы пишет Airflow, хаб их не меняет."""
from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache

from fastapi import HTTPException
from sqlalchemy import Connection, create_engine, text
from sqlalchemy.engine import Engine

from app.config import get_settings

REPORTS_NOT_CONFIGURED = "Подключение к отчётам WB не настроено"
STATEMENT_TIMEOUT = "30s"


@lru_cache
def get_reports_engine() -> Engine | None:
    url = get_settings().wb_database_url
    return create_engine(url, pool_pre_ping=True, pool_size=2, max_overflow=2) if url else None


@contextmanager
def reports_connection() -> Iterator[Connection]:
    """Соединение только для чтения. Не задан HUB_WB_DATABASE_URL — 503."""
    engine = get_reports_engine()
    if engine is None:
        raise HTTPException(503, REPORTS_NOT_CONFIGURED)
    with engine.connect() as conn, conn.begin():
        conn.execute(text("SET TRANSACTION READ ONLY"))
        conn.execute(text(f"SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT}'"))
        yield conn
