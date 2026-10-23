-- ШАГ 5. HR-досье, отпуска, уведомления, личные права на модуль (ревизия Alembic 0005).
-- Выполнять под doadmin, подключившись к базе defaultdb ПОСЛЕ 04_team.sql. Скрипт можно запускать повторно.
-- Права для hub_app выдаются автоматически (ALTER DEFAULT PRIVILEGES в 01_core_hub.sql).
-- Значения денег и документов (hr_employee_sensitive) в журнал не пишутся. TODO(Q-D3): шифрование на уровне приложения не делаем.

-- Личные права на модуль (в дополнение к групповым; итог — максимум). Одно право на пару «пользователь — модуль».
CREATE TABLE IF NOT EXISTS trendsetter_hub.user_module_permissions (
  user_id    bigint NOT NULL REFERENCES trendsetter_hub.users (id) ON DELETE CASCADE,
  module_id  text NOT NULL,
  permission text NOT NULL CHECK (permission IN ('view', 'run', 'responsible')),
  PRIMARY KEY (user_id, module_id)
);

-- Уведомления внутри хаба (колокольчик).
CREATE TABLE IF NOT EXISTS trendsetter_hub.notifications (
  id         bigserial PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES trendsetter_hub.users (id) ON DELETE CASCADE,
  kind       text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL DEFAULT '',
  link       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON trendsetter_hub.notifications (user_id, read_at, created_at DESC);

-- Нормы отпуска по странам. TODO(Q-D1): нормы Армении сверить с юристом/бухгалтером.
CREATE TABLE IF NOT EXISTS trendsetter_hub.hr_leave_policies (
  country                  text PRIMARY KEY CHECK (country IN ('RU', 'AM')),
  days_per_year            numeric(5,2) NOT NULL,
  accrual_per_month        numeric(5,3) NOT NULL,
  first_leave_after_months smallint NOT NULL DEFAULT 0,
  updated_at               timestamptz NOT NULL DEFAULT now()
);
INSERT INTO trendsetter_hub.hr_leave_policies (country, days_per_year, accrual_per_month, first_leave_after_months) VALUES
  ('RU', 28, 2.333, 6),
  ('AM', 28, 2.333, 0)
ON CONFLICT DO NOTHING;

-- Базовое досье (HR, право run на hr).
CREATE TABLE IF NOT EXISTS trendsetter_hub.hr_employee_files (
  person_id         bigint PRIMARY KEY REFERENCES trendsetter_hub.team_people (id) ON DELETE CASCADE,
  legal_name        text,
  birth_date        date,
  country           text CHECK (country IN ('RU', 'AM')),
  employment_type   text CHECK (employment_type IN ('staff', 'gph', 'ip', 'other')),
  hired_at          date,
  probation_until   date,
  contract_no       text,
  contract_date     date,
  work_schedule     text,
  dismissed_at      date,
  dismissal_reason  text,
  phone             text,
  personal_email    text,
  emergency_contact text,
  notes             text,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL
);

-- Деньги и документы (только право responsible на hr).
CREATE TABLE IF NOT EXISTS trendsetter_hub.hr_employee_sensitive (
  person_id    bigint PRIMARY KEY REFERENCES trendsetter_hub.team_people (id) ON DELETE CASCADE,
  salary       numeric(12,2),
  currency     text,
  pay_day_1    smallint,
  pay_day_2    smallint,
  bonus_note   text,
  tax_id       text,
  social_id    text,
  passport     text,
  bank_details text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL
);

-- Начальный остаток и корректировки отпуска (delta может быть отрицательной).
CREATE TABLE IF NOT EXISTS trendsetter_hub.hr_leave_adjustments (
  id         bigserial PRIMARY KEY,
  person_id  bigint NOT NULL REFERENCES trendsetter_hub.team_people (id) ON DELETE CASCADE,
  delta_days numeric(6,2) NOT NULL,
  reason     text NOT NULL DEFAULT '',
  created_by bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_leave_adjustments_person_idx ON trendsetter_hub.hr_leave_adjustments (person_id);

-- Заявки на отпуск. TODO(Q-D2): праздники внутри отпуска считаются как обычные дни.
CREATE TABLE IF NOT EXISTS trendsetter_hub.hr_leave_requests (
  id               bigserial PRIMARY KEY,
  person_id        bigint NOT NULL REFERENCES trendsetter_hub.team_people (id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('annual', 'unpaid', 'study', 'sick', 'other')),
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  days             numeric(6,2) NOT NULL,
  message          text NOT NULL DEFAULT '',
  status           text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approver_user_id bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  decided_by       bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  decided_at       timestamptz,
  decision_comment text,
  created_by       bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS hr_leave_requests_person_idx ON trendsetter_hub.hr_leave_requests (person_id, start_date);
CREATE INDEX IF NOT EXISTS hr_leave_requests_status_idx ON trendsetter_hub.hr_leave_requests (status, approver_user_id);

-- Поле анкеты «Видеосвязь» (после «Соцсети»).
INSERT INTO trendsetter_hub.team_form_fields (key, label, hint, kind, required, options, sort, is_system)
VALUES ('video_link', 'Видеосвязь: Zoom / Яндекс Телемост', NULL, 'links', false, '[]', 125, false)
ON CONFLICT (key) DO NOTHING;
