-- Отмечает, что таблицы документов сотрудника HR уже созданы (ревизия Alembic 0006).
-- Выполнить один раз под doadmin в базе defaultdb (DBeaver) ПОСЛЕ db/06_hr_documents.sql и ДО merge в main.
UPDATE trendsetter_hub.alembic_version SET version_num = '0006' WHERE version_num = '0005';
