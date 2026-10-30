-- Отмечает, что производственный календарь уже применён (ревизия Alembic 0016).
-- Выполнить один раз под doadmin в базе defaultdb ПОСЛЕ db/16_holidays.sql и ДО merge в main.
UPDATE trendsetter_hub.alembic_version SET version_num = '0016' WHERE version_num = '0015';
