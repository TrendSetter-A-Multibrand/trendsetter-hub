-- ШАГ 11. Анкета: системное поле «Пол» (ревизия Alembic 0011).
-- Выполнять под doadmin, подключившись к базе defaultdb ПОСЛЕ 10_news_color.sql. Скрипт можно запускать повторно.
-- Значение хранится текстом опции: 'Мужской' / 'Женский' (answers.gender). Сводка HR приводит их к male / female.
-- Поле обязательное только для новых отправок анкеты; уже утверждённые карточки не меняются. В карту и публичные ответы не попадает.

INSERT INTO trendsetter_hub.team_form_fields (key, label, hint, kind, required, options, sort, is_system)
VALUES ('gender', 'Пол', 'Видит только HR, в карту не попадает', 'select', true, '["Мужской", "Женский"]', 85, true)
ON CONFLICT (key) DO NOTHING;
