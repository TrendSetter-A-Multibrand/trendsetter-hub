-- Отмечает, что таблицы модуля «Карта команды» уже созданы (ревизия Alembic 0004).
-- Выполнить один раз под doadmin в базе defaultdb (DBeaver) ПОСЛЕ db/04_team.sql и ДО merge в main.
UPDATE trendsetter_hub.alembic_version SET version_num = '0004' WHERE version_num = '0003';
