-- ШАГ 7. HR: напоминания, история, оборудование, чек-листы, годовой график отпусков, свои документы (ревизия Alembic 0007).
-- Выполнять под doadmin, подключившись к базе defaultdb ПОСЛЕ 06_hr_documents.sql. Скрипт можно запускать повторно.
-- Права для hub_app выдаются автоматически (ALTER DEFAULT PRIVILEGES в 01_core_hub.sql).
-- В журнал пишутся только id и категории, без ПДн и значений (см. docs/TZ-hr-people-ops.md).

ALTER TABLE trendsetter_hub.hr_employee_files ADD COLUMN IF NOT EXISTS birthday_hidden boolean NOT NULL DEFAULT false;
ALTER TABLE trendsetter_hub.hr_documents ADD COLUMN IF NOT EXISTS visible_to_employee boolean NOT NULL DEFAULT false;

-- Отметки «напоминание уже создано»; для событий без человека person_id = 0 (PK не допускает NULL).
CREATE TABLE IF NOT EXISTS trendsetter_hub.hr_reminder_log (
  day       date NOT NULL,
  kind      text NOT NULL,
  person_id bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, person_id)
);

CREATE TABLE IF NOT EXISTS trendsetter_hub.hr_employee_history (
  id             bigserial PRIMARY KEY,
  person_id      bigint NOT NULL REFERENCES trendsetter_hub.team_people (id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('position', 'salary', 'manager', 'direction', 'status', 'other')),
  effective_date date NOT NULL,
  title          text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  old_value      text,
  new_value      text,
  comment        text,
  auto           boolean NOT NULL DEFAULT false,
  created_by     bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_employee_history_person_idx ON trendsetter_hub.hr_employee_history (person_id, effective_date DESC);

CREATE TABLE IF NOT EXISTS trendsetter_hub.hr_equipment (
  id          bigserial PRIMARY KEY,
  person_id   bigint NOT NULL REFERENCES trendsetter_hub.team_people (id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('laptop', 'phone', 'monitor', 'access_card', 'peripheral', 'other')),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  serial      text,
  issued_at   date NOT NULL,
  return_due  date,
  returned_at date,
  comment     text,
  created_by  bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_equipment_person_idx ON trendsetter_hub.hr_equipment (person_id);

CREATE TABLE IF NOT EXISTS trendsetter_hub.hr_checklist_templates (
  id         bigserial PRIMARY KEY,
  kind       text NOT NULL CHECK (kind IN ('onboarding', 'offboarding')),
  title      text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trendsetter_hub.hr_checklist_template_items (
  id          bigserial PRIMARY KEY,
  template_id bigint NOT NULL REFERENCES trendsetter_hub.hr_checklist_templates (id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  sort        integer NOT NULL DEFAULT 0,
  days_offset smallint
);
CREATE INDEX IF NOT EXISTS hr_checklist_template_items_tpl_idx ON trendsetter_hub.hr_checklist_template_items (template_id, sort);

CREATE TABLE IF NOT EXISTS trendsetter_hub.hr_checklists (
  id          bigserial PRIMARY KEY,
  person_id   bigint NOT NULL REFERENCES trendsetter_hub.team_people (id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('onboarding', 'offboarding')),
  title       text NOT NULL,
  template_id bigint REFERENCES trendsetter_hub.hr_checklist_templates (id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'cancelled')),
  started_at  date NOT NULL,
  created_by  bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz
);
CREATE INDEX IF NOT EXISTS hr_checklists_person_idx ON trendsetter_hub.hr_checklists (person_id);

CREATE TABLE IF NOT EXISTS trendsetter_hub.hr_checklist_items (
  id               bigserial PRIMARY KEY,
  checklist_id     bigint NOT NULL REFERENCES trendsetter_hub.hr_checklists (id) ON DELETE CASCADE,
  title            text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  sort             integer NOT NULL DEFAULT 0,
  assignee_user_id bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  due_date         date,
  done             boolean NOT NULL DEFAULT false,
  done_at          timestamptz,
  done_by          bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  note             text CHECK (note IS NULL OR char_length(note) <= 500)
);
CREATE INDEX IF NOT EXISTS hr_checklist_items_list_idx ON trendsetter_hub.hr_checklist_items (checklist_id, sort);
CREATE INDEX IF NOT EXISTS hr_checklist_items_assignee_idx ON trendsetter_hub.hr_checklist_items (assignee_user_id) WHERE assignee_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS trendsetter_hub.hr_leave_plans (
  id         bigserial PRIMARY KEY,
  person_id  bigint NOT NULL REFERENCES trendsetter_hub.team_people (id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date   date NOT NULL,
  comment    text CHECK (comment IS NULL OR char_length(comment) <= 300),
  status     text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'cancelled', 'converted')),
  request_id bigint REFERENCES trendsetter_hub.hr_leave_requests (id) ON DELETE SET NULL,
  created_by bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS hr_leave_plans_person_idx ON trendsetter_hub.hr_leave_plans (person_id, start_date);

-- Сид двух шаблонов. Повторный запуск не дублирует: шаблон и его пункты добавляются, только если шаблона с таким видом и названием ещё нет.
WITH t AS (
  INSERT INTO trendsetter_hub.hr_checklist_templates (kind, title)
  SELECT 'onboarding', 'Онбординг: новый сотрудник'
  WHERE NOT EXISTS (SELECT 1 FROM trendsetter_hub.hr_checklist_templates WHERE kind = 'onboarding' AND title = 'Онбординг: новый сотрудник')
  RETURNING id
)
INSERT INTO trendsetter_hub.hr_checklist_template_items (template_id, title, sort, days_offset)
SELECT t.id, i.title, i.sort, i.days_offset FROM t, (VALUES
  ('Создать аккаунты и корпоративную почту', 1, 0),
  ('Выдать доступ в хаб', 2, 0),
  ('Выдать оборудование', 3, 1),
  ('Ознакомить с документами и регламентами', 4, 3),
  ('Назначить наставника', 5, 1),
  ('Познакомить с командой', 6, 3),
  ('Подвести итоги первой недели', 7, 7)
) AS i (title, sort, days_offset);

WITH t AS (
  INSERT INTO trendsetter_hub.hr_checklist_templates (kind, title)
  SELECT 'offboarding', 'Оффбординг: увольнение'
  WHERE NOT EXISTS (SELECT 1 FROM trendsetter_hub.hr_checklist_templates WHERE kind = 'offboarding' AND title = 'Оффбординг: увольнение')
  RETURNING id
)
INSERT INTO trendsetter_hub.hr_checklist_template_items (template_id, title, sort, days_offset)
SELECT t.id, i.title, i.sort, i.days_offset FROM t, (VALUES
  ('Отключить доступы и аккаунты', 1, 0),
  ('Вернуть оборудование', 2, 0),
  ('Произвести расчёт', 3, 0),
  ('Передать дела', 4, 0),
  ('Отметить уволенным в хабе', 5, 0),
  ('Экспортировать документы', 6, 1)
) AS i (title, sort, days_offset);
