-- Отмечает, что предложка и модерация новостей уже применены (ревизия Alembic 0014).
-- Выполнить один раз под doadmin в базе defaultdb ПОСЛЕ db/14_news_moderation.sql и ДО merge в main.
UPDATE trendsetter_hub.alembic_version SET version_num = '0014' WHERE version_num = '0013';
