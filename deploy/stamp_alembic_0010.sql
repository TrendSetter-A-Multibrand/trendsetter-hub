-- Отмечает, что столбец news_items.color уже создан (ревизия Alembic 0010).
-- Выполнить один раз под doadmin в базе defaultdb (DBeaver) ПОСЛЕ db/10_news_color.sql и ДО merge в main.
UPDATE trendsetter_hub.alembic_version SET version_num = '0010' WHERE version_num = '0009';
