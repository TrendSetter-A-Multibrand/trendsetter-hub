-- ШАГ 1. Ядро хаба: схема trendsetter_hub в базе defaultdb — отделы, пользователи (вход по почте и паролю),
-- доступ, журнал. Модули хаба кладут свои таблицы в ТУ ЖЕ схему с приставкой имени модуля (warehouse_*, purchasing_* …).
-- Выполнять под doadmin, подключившись к базе defaultdb. Ничего вне схемы trendsetter_hub (procurement, meta, public)
-- скрипт не трогает.

CREATE SCHEMA IF NOT EXISTS trendsetter_hub;
GRANT USAGE ON SCHEMA trendsetter_hub TO hub_app;
-- Таблицы и последовательности, которые появятся в схеме позже, получат права автоматически
ALTER DEFAULT PRIVILEGES IN SCHEMA trendsetter_hub GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hub_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA trendsetter_hub GRANT USAGE, SELECT ON SEQUENCES TO hub_app;

-- Отделы — справочник: новый отдел добавляется строкой, без деплоя
CREATE TABLE IF NOT EXISTS trendsetter_hub.departments (
  id   smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{1,31}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64)
);
CREATE UNIQUE INDEX IF NOT EXISTS departments_name_lower_key ON trendsetter_hub.departments (lower(name));

-- Пользователи. Пароль хранится только как bcrypt-хэш. Сброса пароля по почте нет: пароль меняет админ.
CREATE TABLE IF NOT EXISTS trendsetter_hub.users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text NOT NULL,
  full_name     text NOT NULL CHECK (char_length(full_name) BETWEEN 1 AND 120),
  password_hash text NOT NULL,
  access_level  text NOT NULL CHECK (access_level IN ('admin', 'superuser', 'employee', 'viewer')),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON trendsetter_hub.users (lower(email));

-- В каких отделах состоит сотрудник
CREATE TABLE IF NOT EXISTS trendsetter_hub.user_departments (
  user_id       bigint   NOT NULL REFERENCES trendsetter_hub.users (id) ON DELETE CASCADE,
  department_id smallint NOT NULL REFERENCES trendsetter_hub.departments (id) ON DELETE RESTRICT,
  PRIMARY KEY (user_id, department_id)
);

-- Какому отделу принадлежит модуль (сотрудник отдела может запускать модуль, остальные только смотрят)
CREATE TABLE IF NOT EXISTS trendsetter_hub.module_departments (
  module_id     text     NOT NULL CHECK (module_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  department_id smallint NOT NULL REFERENCES trendsetter_hub.departments (id) ON DELETE CASCADE,
  PRIMARY KEY (module_id, department_id)
);

-- Журнал действий (вход, загрузка, запуск, завершение и т. д.)
CREATE TABLE IF NOT EXISTS trendsetter_hub.audit_log (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at        timestamptz NOT NULL DEFAULT now(),
  user_id   bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  action    text NOT NULL,
  module_id text,
  details   jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS audit_log_at_idx ON trendsetter_hub.audit_log (at DESC);
CREATE INDEX IF NOT EXISTS audit_log_user_idx ON trendsetter_hub.audit_log (user_id);

-- Стартовые данные: отделы и привязка модулей (первый администратор создаётся отдельно командой бэкенда,
-- пароли в SQL-файлах не хранятся)
INSERT INTO trendsetter_hub.departments (code, name) VALUES
  ('purchasing', 'Закупки'),
  ('warehouse',  'Склад'),
  ('wb',         'WB-отдел'),
  ('analytics',  'Аналитика'),
  ('pricing',    'Ценообразование')
ON CONFLICT (code) DO NOTHING;

INSERT INTO trendsetter_hub.module_departments (module_id, department_id)
SELECT m.module_id, d.id
FROM (VALUES ('purchasing', 'purchasing'), ('warehouse', 'warehouse'), ('wb', 'wb'),
             ('analytics', 'analytics'), ('pricing', 'pricing')) AS m (module_id, dept_code)
JOIN trendsetter_hub.departments d ON d.code = m.dept_code
ON CONFLICT DO NOTHING;
