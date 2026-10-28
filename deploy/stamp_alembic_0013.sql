-- Отмечает, что таблица wb_marking_imported уже создана (ревизия Alembic 0013).
-- Выполнить один раз под doadmin в базе defaultdb ПОСЛЕ db/modules/wb/002_wb_marking_imported.sql и ДО merge в main.
UPDATE trendsetter_hub.alembic_version SET version_num = '0013' WHERE version_num = '0012';
