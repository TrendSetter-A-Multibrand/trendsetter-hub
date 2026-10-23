-- Отмечает, что таблицы HR (напоминания, история, оборудование, чек-листы, график отпусков) уже созданы (ревизия Alembic 0007).
-- Выполнить один раз под doadmin в базе defaultdb (DBeaver) ПОСЛЕ db/07_hr_people_ops.sql и ДО merge в main.
UPDATE trendsetter_hub.alembic_version SET version_num = '0007' WHERE version_num = '0006';
