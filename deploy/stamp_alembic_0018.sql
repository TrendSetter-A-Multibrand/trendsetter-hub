-- Отмечает, что обратная связь сотрудников уже применена (ревизия Alembic 0018).
-- Выполнить один раз под doadmin в базе defaultdb ПОСЛЕ db/18_feedback.sql и ДО merge в main.
UPDATE trendsetter_hub.alembic_version SET version_num = '0018' WHERE version_num = '0017';
