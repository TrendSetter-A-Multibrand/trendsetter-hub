-- Отмечает, что онбординг нового сотрудника уже применён (ревизия Alembic 0017).
-- Выполнить один раз под doadmin в базе defaultdb ПОСЛЕ db/17_onboarding.sql и ДО merge в main.
UPDATE trendsetter_hub.alembic_version SET version_num = '0017' WHERE version_num = '0016';
