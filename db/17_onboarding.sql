-- ШАГ 17. Онбординг нового сотрудника (ядро, ревизия Alembic 0017).
-- Выполнять под doadmin, подключившись к базе defaultdb ПОСЛЕ 16_holidays.sql. Скрипт можно запускать повторно.
-- Права hub_app выдаются автоматически (ALTER DEFAULT PRIVILEGES из 01_core_hub.sql).

ALTER TABLE trendsetter_hub.users ALTER COLUMN access_level DROP NOT NULL;
ALTER TABLE trendsetter_hub.users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE trendsetter_hub.users ADD COLUMN IF NOT EXISTS onboarding boolean NOT NULL DEFAULT false;
ALTER TABLE trendsetter_hub.users ADD COLUMN IF NOT EXISTS onboarding_expires_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'trendsetter_hub.users'::regclass AND conname = 'users_level_or_onboarding_check'
  ) THEN
    ALTER TABLE trendsetter_hub.users
      ADD CONSTRAINT users_level_or_onboarding_check CHECK (access_level IS NOT NULL OR onboarding);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'trendsetter_hub.users'::regclass AND conname = 'users_must_change_password_check'
  ) THEN
    ALTER TABLE trendsetter_hub.users
      ADD CONSTRAINT users_must_change_password_check CHECK (NOT must_change_password OR onboarding);
  END IF;
END
$$;

-- Общий стартовый пароль: ровно одна строка. Пока password_hash IS NULL, самосоздание и вход общим паролем выключены.
CREATE TABLE IF NOT EXISTS trendsetter_hub.onboarding_settings (
  id            smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  password_hash text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL
);

INSERT INTO trendsetter_hub.onboarding_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
