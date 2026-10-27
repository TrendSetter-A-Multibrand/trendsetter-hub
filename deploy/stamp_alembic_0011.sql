-- Отмечает, что поле анкеты «Пол» уже создано (ревизия Alembic 0011).
-- Выполнить один раз под doadmin в базе defaultdb (DBeaver) ПОСЛЕ db/11_gender_field.sql и ДО merge в main.
UPDATE trendsetter_hub.alembic_version SET version_num = '0011' WHERE version_num = '0010';
