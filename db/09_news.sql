-- ШАГ 9. Новости компании: записи (новости и события), ответы «Кто пойдёт», срочная плашка (ревизия Alembic 0009).
-- Выполнять под doadmin, подключившись к базе defaultdb ПОСЛЕ 08_security.sql. Скрипт можно запускать повторно.
-- Права для hub_app выдаются автоматически (ALTER DEFAULT PRIVILEGES в 01_core_hub.sql: и таблицы, и последовательности).
-- Права на модуль «news» — без DDL: «Особые права» и группы уже работают для любого модуля из реестра приложения.

CREATE TABLE IF NOT EXISTS trendsetter_hub.news_items (
  id                 bigserial PRIMARY KEY,
  kind               text NOT NULL CHECK (kind IN ('news', 'event')),
  title              text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body               text NOT NULL DEFAULT '' CHECK (char_length(body) <= 5000),
  place              text CHECK (place IS NULL OR char_length(place) BETWEEN 1 AND 200),
  starts_at          timestamptz,
  ends_at            timestamptz,
  pinned             boolean NOT NULL DEFAULT false,
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  archived           boolean NOT NULL DEFAULT false,
  rsvp_enabled       boolean NOT NULL DEFAULT false,
  rsvp_deadline      timestamptz,
  rsvp_names_public  boolean NOT NULL DEFAULT false,
  published_at       timestamptz,
  created_by         bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'event' OR (starts_at IS NULL AND ends_at IS NULL AND place IS NULL
                            AND NOT rsvp_enabled AND rsvp_deadline IS NULL AND NOT rsvp_names_public)),
  CHECK (kind = 'news' OR starts_at IS NOT NULL),
  CHECK (ends_at IS NULL OR ends_at >= starts_at),
  CHECK (rsvp_deadline IS NULL OR rsvp_deadline <= starts_at)
);
CREATE INDEX IF NOT EXISTS news_items_feed_idx ON trendsetter_hub.news_items (status, archived, kind, starts_at);

CREATE TABLE IF NOT EXISTS trendsetter_hub.news_rsvp (
  item_id    bigint NOT NULL REFERENCES trendsetter_hub.news_items (id) ON DELETE CASCADE,
  user_id    bigint NOT NULL REFERENCES trendsetter_hub.users (id) ON DELETE CASCADE,
  answer     text NOT NULL CHECK (answer IN ('yes', 'maybe', 'no')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, user_id)
);

CREATE TABLE IF NOT EXISTS trendsetter_hub.news_banners (
  id         bigserial PRIMARY KEY,
  text       text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 300),
  active     boolean NOT NULL DEFAULT true,
  ends_at    timestamptz,
  created_by bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Не больше одной активной плашки
CREATE UNIQUE INDEX IF NOT EXISTS news_banners_one_active ON trendsetter_hub.news_banners (active) WHERE active;
