-- Отмечает, что таблица wb_marking_documents уже создана (ревизия Alembic 0012).
-- Выполнить один раз под doadmin в базе defaultdb ПОСЛЕ db/modules/wb/001_wb_marking.sql и ДО merge в main.
UPDATE trendsetter_hub.alembic_version SET version_num = '0012' WHERE version_num = '0011';
