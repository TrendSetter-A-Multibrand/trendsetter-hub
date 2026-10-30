-- Отмечает, что виджеты главной и порядок закреплённых новостей уже применены (ревизия Alembic 0015).
-- Выполнить один раз под doadmin в базе defaultdb ПОСЛЕ db/15_home_widgets.sql и ДО merge в main.
UPDATE trendsetter_hub.alembic_version SET version_num = '0015' WHERE version_num = '0014';
