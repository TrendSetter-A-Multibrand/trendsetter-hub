-- ШАГ 14. Новости: предложка и модерация (ревизия Alembic 0014).
-- Выполнять под doadmin, подключившись к базе defaultdb ПОСЛЕ modules/wb/002_wb_marking_imported.sql. Скрипт можно запускать повторно.
-- Предложение = запись с submitted_at IS NOT NULL (автор — created_by). Статусы: draft, pending, needs_changes, published, rejected.
-- Права hub_app уже выданы на таблицу целиком.

ALTER TABLE trendsetter_hub.news_items ADD COLUMN IF NOT EXISTS submitted_at   timestamptz;
ALTER TABLE trendsetter_hub.news_items ADD COLUMN IF NOT EXISTS review_comment text;
ALTER TABLE trendsetter_hub.news_items ADD COLUMN IF NOT EXISTS reviewed_by    bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL;
ALTER TABLE trendsetter_hub.news_items ADD COLUMN IF NOT EXISTS reviewed_at    timestamptz;

DO $$
DECLARE
  old_name text;
BEGIN
  -- Старое inline-ограничение статуса из 09_news.sql: имя не хардкодим, ищем по определению.
  FOR old_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'trendsetter_hub.news_items'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
      AND pg_get_constraintdef(oid) LIKE '%published%'
      AND pg_get_constraintdef(oid) NOT LIKE '%pending%'
  LOOP
    EXECUTE format('ALTER TABLE trendsetter_hub.news_items DROP CONSTRAINT %I', old_name);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'trendsetter_hub.news_items'::regclass AND conname = 'news_items_status_v2_check'
  ) THEN
    ALTER TABLE trendsetter_hub.news_items
      ADD CONSTRAINT news_items_status_v2_check
      CHECK (status IN ('draft', 'pending', 'needs_changes', 'published', 'rejected'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'trendsetter_hub.news_items'::regclass AND conname = 'news_items_review_comment_check'
  ) THEN
    ALTER TABLE trendsetter_hub.news_items
      ADD CONSTRAINT news_items_review_comment_check
      CHECK (review_comment IS NULL OR char_length(review_comment) BETWEEN 1 AND 1000);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'trendsetter_hub.news_items'::regclass AND conname = 'news_items_proposal_check'
  ) THEN
    ALTER TABLE trendsetter_hub.news_items
      ADD CONSTRAINT news_items_proposal_check
      CHECK (status NOT IN ('pending', 'needs_changes', 'rejected') OR submitted_at IS NOT NULL);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS news_items_author_idx  ON trendsetter_hub.news_items (created_by, created_at) WHERE submitted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS news_items_pending_idx ON trendsetter_hub.news_items (submitted_at) WHERE status = 'pending';
