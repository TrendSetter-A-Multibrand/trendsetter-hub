-- Отмечает, что группы доступа уже созданы (ревизия Alembic 0002).
-- Выполнить один раз под doadmin в базе defaultdb (DBeaver) ПОСЛЕ db/02_access_groups.sql и ДО merge в main.
-- Это то же, что `alembic stamp 0002`, но без хранения пароля doadmin на сервере.
UPDATE trendsetter_hub.alembic_version SET version_num = '0002' WHERE version_num = '0001';
