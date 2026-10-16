-- ШАБЛОН ДЛЯ НОВОГО МОДУЛЯ. Скопируйте в db/modules/<имя>/001_<имя>.sql и замените <module> на id модуля
-- (латиница, строчные, как в frontend/src/modules/registry.js: purchasing, wb, analytics, pricing …).
-- Выполнять под doadmin в базе trendsetter_hab.

-- 1. Своя схема модуля: его таблицы лежат только здесь, ядро (hub) и другие модули их не трогают
CREATE SCHEMA IF NOT EXISTS <module>;

-- 2. Права приложению: читать и писать данные, но не менять структуру
GRANT USAGE ON SCHEMA <module> TO hub_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA <module> GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hub_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA <module> GRANT USAGE, SELECT ON SEQUENCES TO hub_app;

-- 3. Таблицы модуля. Кто что сделал — ссылкой на hub.users, а не текстом с почтой.
-- CREATE TABLE IF NOT EXISTS <module>.example (
--   id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
--   created_at timestamptz NOT NULL DEFAULT now(),
--   created_by bigint REFERENCES hub.users (id) ON DELETE SET NULL
-- );

-- 4. Привязка модуля к отделу (кто из сотрудников может его запускать)
-- INSERT INTO hub.module_departments (module_id, department_id)
-- SELECT '<module>', id FROM hub.departments WHERE code = '<department_code>' ON CONFLICT DO NOTHING;
