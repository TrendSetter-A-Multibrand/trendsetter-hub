-- Отмечает, что схема trendsetter_hub уже создана (ревизия Alembic 0001), чтобы дальше миграции шли от неё.
-- Выполнить один раз под doadmin в базе defaultdb (DBeaver). Это то же, что `alembic stamp head`,
-- но без хранения пароля doadmin на сервере.
CREATE TABLE IF NOT EXISTS trendsetter_hub.alembic_version (
  version_num varchar(32) NOT NULL,
  CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);
INSERT INTO trendsetter_hub.alembic_version (version_num) VALUES ('0001') ON CONFLICT DO NOTHING;
