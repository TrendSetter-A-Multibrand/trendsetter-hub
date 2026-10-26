-- ШАГ 10. Новости: цвет записи (ревизия Alembic 0010).
-- Выполнять под doadmin, подключившись к базе defaultdb ПОСЛЕ 09_news.sql. Скрипт можно запускать повторно.
-- Хранится ключ цвета, а не hex: NULL = нейтральный (по умолчанию). Права hub_app уже выданы на таблицу целиком.

ALTER TABLE trendsetter_hub.news_items ADD COLUMN IF NOT EXISTS color text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'trendsetter_hub.news_items'::regclass AND conname = 'news_items_color_check'
  ) THEN
    ALTER TABLE trendsetter_hub.news_items
      ADD CONSTRAINT news_items_color_check
      CHECK (color IS NULL OR color IN ('red', 'green', 'yellow', 'blue', 'pink', 'gray'));
  END IF;
END
$$;
