-- ШАГ 16. Производственный календарь РФ и Армении (модуль holidays, ревизия Alembic 0016).
-- Выполнять под doadmin, подключившись к базе defaultdb ПОСЛЕ 15_home_widgets.sql. Скрипт можно запускать повторно.
-- Права hub_app выдаются автоматически (ALTER DEFAULT PRIVILEGES из 01_core_hub.sql). В БД только исключения: суббота и воскресенье без строки — выходной.

CREATE TABLE IF NOT EXISTS trendsetter_hub.holidays_days (
  country    text NOT NULL CHECK (country IN ('RU', 'AM')),
  day        date NOT NULL CHECK (day BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
  kind       text NOT NULL CHECK (kind IN ('holiday', 'day_off', 'workday', 'short')),
  name       text CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 100),
  updated_by bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (country, day),
  CONSTRAINT holidays_days_holiday_name_check CHECK (kind <> 'holiday' OR name IS NOT NULL),
  CONSTRAINT holidays_days_workday_check CHECK (kind <> 'workday' OR extract(isodow FROM day) IN (6, 7))
);
