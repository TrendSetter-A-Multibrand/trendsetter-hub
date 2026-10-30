-- ШАГ 15. Виджеты главной и порядок закреплённых новостей (ревизия Alembic 0015).
-- Выполнять под doadmin, подключившись к базе defaultdb ПОСЛЕ 14_news_moderation.sql. Скрипт можно запускать повторно.
-- Пустая home_widgets = порядок по умолчанию, всё включено (сидов нет). Права hub_app выдаются автоматически (ALTER DEFAULT PRIVILEGES из 01_core_hub.sql).

ALTER TABLE trendsetter_hub.news_items ADD COLUMN IF NOT EXISTS sort integer;  -- порядок среди закреплённых; NULL у незакреплённых

CREATE TABLE IF NOT EXISTS trendsetter_hub.home_widgets (
  widget_id  text PRIMARY KEY CHECK (widget_id ~ '^[a-z0-9-]{1,40}$'),
  position   integer NOT NULL CHECK (position >= 0),
  enabled    boolean NOT NULL DEFAULT true,
  updated_by bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
