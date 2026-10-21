-- ШАГ 3. Модули «HR» и «Карта команды» (ревизия Alembic 0003). Таблиц пока нет — только отдел и привязка.
-- Модуль «Карта команды» (team) виден всем сотрудникам без привязки к отделу (флаг for_all в манифесте бэкенда).
-- Выполнять под doadmin, подключившись к базе defaultdb. Скрипт можно запускать повторно.

INSERT INTO trendsetter_hub.departments (code, name) VALUES ('hr', 'HR')
ON CONFLICT (code) DO NOTHING;

INSERT INTO trendsetter_hub.module_departments (module_id, department_id)
SELECT 'hr', id FROM trendsetter_hub.departments WHERE code = 'hr'
ON CONFLICT DO NOTHING;
