-- Отмечает, что отдел HR уже создан (ревизия Alembic 0003).
-- Выполнить один раз под doadmin в базе defaultdb (DBeaver) ПОСЛЕ db/03_hr_team_modules.sql и ДО merge в main.
UPDATE trendsetter_hub.alembic_version SET version_num = '0003' WHERE version_num = '0002';
