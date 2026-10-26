-- Отмечает, что таблицы новостей news_* уже созданы (ревизия Alembic 0009).
-- Выполнить один раз под doadmin в базе defaultdb (DBeaver) ПОСЛЕ db/09_news.sql и ДО merge в main.
UPDATE trendsetter_hub.alembic_version SET version_num = '0009' WHERE version_num = '0008';
