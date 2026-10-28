-- Модуль «Wildberries», раздел «Маркировка» (ревизия Alembic 0010).
-- Выполнять под doadmin в базе defaultdb ПОСЛЕ 09_news.sql. Скрипт можно запускать повторно.
-- Права hub_app — автоматически (ALTER DEFAULT PRIVILEGES в 01_core_hub.sql). Привязка wb → отдел wb уже есть в 01_core_hub.sql.
--
-- Сами отчёты WB (api_wb_FinanceReport, api_wb_Orders_FBS, api_wb_ExciseReport) лежат в схеме public и хабом только читаются
-- отдельным подключением HUB_WB_DATABASE_URL. Здесь — только то, что вносят в хабе: номер документа «Честного ЗНАКа» по строке сверки.

CREATE TABLE IF NOT EXISTS trendsetter_hub.wb_marking_documents (
  item_key   text PRIMARY KEY CHECK (char_length(item_key) BETWEEN 1 AND 300),  -- <list>:<srid>:<код маркировки>
  list       text NOT NULL CHECK (list IN ('withdraw', 'return')),
  document   text NOT NULL CHECK (char_length(document) BETWEEN 1 AND 100),
  updated_by bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
