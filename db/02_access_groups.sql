-- ШАГ 2. Группы доступа (ревизия Alembic 0002): набор прав по модулям (view / run / responsible) и участники группы.
-- Права группы только добавляются к уровню и отделам сотрудника (итог = максимум). Таблицы ядра — без приставки модуля.
-- Выполнять под doadmin, подключившись к базе defaultdb. Ничего вне схемы trendsetter_hub скрипт не трогает.
-- Скрипт можно запускать повторно: существующее он пропускает.

CREATE TABLE IF NOT EXISTS trendsetter_hub.access_groups (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS access_groups_name_lower_key ON trendsetter_hub.access_groups (lower(name));

CREATE TABLE IF NOT EXISTS trendsetter_hub.access_group_permissions (
  group_id   bigint NOT NULL REFERENCES trendsetter_hub.access_groups (id) ON DELETE CASCADE,
  module_id  text   NOT NULL CHECK (module_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  permission text   NOT NULL CHECK (permission IN ('view', 'run', 'responsible')),
  PRIMARY KEY (group_id, module_id)
);

CREATE TABLE IF NOT EXISTS trendsetter_hub.access_group_members (
  group_id bigint NOT NULL REFERENCES trendsetter_hub.access_groups (id) ON DELETE CASCADE,
  user_id  bigint NOT NULL REFERENCES trendsetter_hub.users (id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS access_group_members_user_idx ON trendsetter_hub.access_group_members (user_id);

-- Явно, не полагаясь только на ALTER DEFAULT PRIVILEGES
GRANT SELECT, INSERT, UPDATE, DELETE ON trendsetter_hub.access_groups, trendsetter_hub.access_group_permissions,
  trendsetter_hub.access_group_members TO hub_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA trendsetter_hub TO hub_app;
