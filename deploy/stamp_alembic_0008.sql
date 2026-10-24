-- Отмечает, что столбец users.token_version и индексы журнала уже созданы (ревизия Alembic 0008).
-- Выполнить один раз под doadmin в базе defaultdb (DBeaver) ПОСЛЕ db/08_security.sql и ДО merge в main.
UPDATE trendsetter_hub.alembic_version SET version_num = '0008' WHERE version_num = '0007';
