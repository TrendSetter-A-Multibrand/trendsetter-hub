-- ШАБЛОН ДЛЯ НОВОГО МОДУЛЯ. Скопируйте в db/modules/<имя>/001_<имя>.sql и замените <module> на id модуля
-- (латиница, строчные, как в frontend/src/modules/registry.js: purchasing, wb, analytics, pricing …).
-- Выполнять под doadmin в базе defaultdb.
--
-- Правило: все таблицы хаба лежат в одной схеме trendsetter_hub. Таблицы модуля называются с приставкой модуля:
-- <module>_<таблица> (например warehouse_scans). Индексы и ограничения называем так же с приставкой —
-- имена должны быть уникальны в пределах схемы. Права для hub_app выдаются автоматически (см. 01_core_hub.sql).

-- Таблицы модуля. Кто что сделал — ссылкой на trendsetter_hub.users, а не текстом с почтой.
-- CREATE TABLE IF NOT EXISTS trendsetter_hub.<module>_example (
--   id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
--   created_at timestamptz NOT NULL DEFAULT now(),
--   created_by bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL
-- );

-- Привязка модуля к отделу (кто из сотрудников может его запускать)
-- INSERT INTO trendsetter_hub.module_departments (module_id, department_id)
-- SELECT '<module>', id FROM trendsetter_hub.departments WHERE code = '<department_code>' ON CONFLICT DO NOTHING;
