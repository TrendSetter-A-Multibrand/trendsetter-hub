-- ШАГ 18. Обратная связь сотрудников (модуль feedback, ревизия Alembic 0018).
-- Выполнять под doadmin, подключившись к базе defaultdb ПОСЛЕ 17_onboarding.sql. Скрипт можно запускать повторно.
-- Права hub_app — автоматически (ALTER DEFAULT PRIVILEGES из 01_core_hub.sql). Текст и комментарий хранятся только зашифрованными (enc:v1:…). У анонимных сообщений автор не хранится.

CREATE TABLE IF NOT EXISTS trendsetter_hub.feedback_messages (
  id            bigserial PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('thanks', 'idea', 'complaint', 'other')),
  body          text NOT NULL CHECK (body LIKE 'enc:v1:%'),
  is_anonymous  boolean NOT NULL,
  author_id     bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  contact_ok    boolean NOT NULL DEFAULT false,
  recipient_id  bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'closed')),
  note          text CHECK (note IS NULL OR note LIKE 'enc:v1:%'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  CONSTRAINT feedback_messages_anonymous_check CHECK (NOT is_anonymous OR (author_id IS NULL AND NOT contact_ok)),
  CONSTRAINT feedback_messages_recipient_check CHECK (kind = 'thanks' OR recipient_id IS NULL)
);
CREATE INDEX IF NOT EXISTS feedback_messages_status_idx ON trendsetter_hub.feedback_messages (status, id DESC);
CREATE INDEX IF NOT EXISTS feedback_messages_author_idx ON trendsetter_hub.feedback_messages (author_id) WHERE author_id IS NOT NULL;
