-- Отмечает, что таблицы HR-досье, отпусков, уведомлений и личных прав уже созданы (ревизия Alembic 0005).
-- Выполнить один раз под doadmin в базе defaultdb (DBeaver) ПОСЛЕ db/05_hr_dossier.sql и ДО merge в main.
UPDATE trendsetter_hub.alembic_version SET version_num = '0005' WHERE version_num = '0004';
