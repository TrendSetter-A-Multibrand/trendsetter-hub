-- ШАГ 8. Безопасность: закрытие сессий (users.token_version) и индексы журнала (ревизия Alembic 0008).
-- Выполнять под doadmin, подключившись к базе defaultdb ПОСЛЕ 07_hr_people_ops.sql. Скрипт можно запускать повторно.
-- Права для hub_app выдаются автоматически (ALTER DEFAULT PRIVILEGES в 01_core_hub.sql); новых таблиц нет.
-- Шифрование ПДн делается в приложении (HUB_PII_KEY), структура БД не меняется: зашифрованные значения лежат в тех же text/bytea-столбцах.

-- Версия токена: смена или сброс пароля увеличивает её, и прежние токены пользователя перестают действовать.
ALTER TABLE trendsetter_hub.users ADD COLUMN IF NOT EXISTS token_version int NOT NULL DEFAULT 0;

-- Журнал: выборка по действию и времени, по человеку (details->>'person_id').
CREATE INDEX IF NOT EXISTS audit_log_action_at_idx ON trendsetter_hub.audit_log (action, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_person_idx ON trendsetter_hub.audit_log ((details ->> 'person_id'));
