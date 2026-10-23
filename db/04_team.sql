-- ШАГ 4. Модуль «Карта команды» (team): таблицы и справочник направлений (ревизия Alembic 0004).
-- Людей здесь НЕТ (персональные данные не хранятся в git): их разово загружает команда
-- python -m app.modules.team.seed <team.json> --apply (backend/app/modules/team/seed.py).
-- Выполнять под doadmin, подключившись к базе defaultdb ПОСЛЕ 01_core_hub.sql. Скрипт можно запускать повторно.
-- Права для hub_app выдаются автоматически (ALTER DEFAULT PRIVILEGES в 01_core_hub.sql).

-- Направления (справочник; цвета — брендбук). leadership — для CEO и ассистента.
CREATE TABLE IF NOT EXISTS trendsetter_hub.team_directions (
  id         text PRIMARY KEY,
  label      text NOT NULL,
  short_name text NOT NULL,
  color      text NOT NULL,
  avatar_ink text NOT NULL,
  sort       integer NOT NULL DEFAULT 0
);

INSERT INTO trendsetter_hub.team_directions (id, label, short_name, color, avatar_ink, sort) VALUES
  ('leadership', 'РУКОВОДСТВО',           'Руководство',     '#A22325', '#FFFFFF', 0),
  ('ops',        'ОПЕРАЦИИ',             'Операции',        '#1D428A', '#FFFFFF', 1),
  ('mkt',        'МАРКЕТИНГ',            'Маркетинг',       '#FE5000', '#FFFFFF', 2),
  ('buy',        'ЗАКУПКИ',              'Закупки',         '#F3D03E', '#252120', 3),
  ('stm',        'ПРОИЗВОДСТВО СТМ',     'СТМ',             '#7CE0D3', '#252120', 4),
  ('fin',        'ФИНАНСЫ',              'Финансы',         '#005844', '#FFFFFF', 5),
  ('it',         'IT',                   'IT',              '#C6DAE7', '#252120', 6),
  ('gen',        'ГЕНЕРАЛЬНЫЙ ДИРЕКТОР', 'Ген. директор',   '#252120', '#FFFFFF', 7),
  ('an',         'БИЗНЕС-АНАЛИТИКА',     'Аналитика',       '#71CC98', '#252120', 8),
  ('hr',         'ПЕРСОНАЛ',             'Персонал',        '#E59BDC', '#252120', 9),
  ('spec',       'СПЕЦНАПРАВЛЕНИЯ',      'Спецнаправления', '#B3ACA9', '#252120', 10)
ON CONFLICT DO NOTHING;

-- Карточки людей. user_id — связь с учёткой хаба (может отсутствовать); answers — ответы анкеты по ключу поля.
CREATE TABLE IF NOT EXISTS trendsetter_hub.team_people (
  id            bigserial PRIMARY KEY,
  user_id       bigint UNIQUE REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  email         text,
  first_name    text NOT NULL,
  last_name     text NOT NULL,
  title         text NOT NULL,
  manager_id    bigint REFERENCES trendsetter_hub.team_people (id),
  direction_id  text NOT NULL REFERENCES trendsetter_hub.team_directions (id),
  tag           text,
  team          text,
  is_ceo        boolean NOT NULL DEFAULT false,
  is_assistant  boolean NOT NULL DEFAULT false,
  show_in_map   boolean NOT NULL DEFAULT true,
  is_archived   boolean NOT NULL DEFAULT false,
  answers       jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort          integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS team_people_email_lower_key ON trendsetter_hub.team_people (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS team_people_manager_idx ON trendsetter_hub.team_people (manager_id);

-- Фото хранятся в БД (JPEG: полное до 300 КБ, превью до 30 КБ).
-- Колонки называются photo_full/photo_thumb (FULL — зарезервированное слово PostgreSQL).
CREATE TABLE IF NOT EXISTS trendsetter_hub.team_photos (
  person_id   bigint PRIMARY KEY REFERENCES trendsetter_hub.team_people (id) ON DELETE CASCADE,
  photo_full  bytea NOT NULL,
  photo_thumb bytea NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Поля анкеты (конструктор HR). Ключ неизменяем; системные поля нельзя скрыть.
CREATE TABLE IF NOT EXISTS trendsetter_hub.team_form_fields (
  id        bigserial PRIMARY KEY,
  key       text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label     text NOT NULL,
  hint      text,
  kind      text NOT NULL CHECK (kind IN ('text', 'textarea', 'select', 'chips', 'links', 'photo')),
  required  boolean NOT NULL DEFAULT false,
  options   jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort      integer NOT NULL DEFAULT 0,
  is_system boolean NOT NULL DEFAULT false,
  active    boolean NOT NULL DEFAULT true
);

INSERT INTO trendsetter_hub.team_form_fields (key, label, hint, kind, required, options, sort, is_system) VALUES
  ('first_name',     'Имя',                    NULL, 'text', true, '[]', 10, true),
  ('last_name',      'Фамилия',                NULL, 'text', true, '[]', 20, true),
  ('title',          'Должность',              NULL, 'text', true, '[]', 30, true),
  ('manager_claim',  'Твой руководитель (ФИ)', 'Подсказка для HR, в карту не попадает', 'text', true, '[]', 40, true),
  ('responsibility', 'Зона ответственности',   NULL, 'textarea', true, '[]', 50, true),
  ('ask_me_about',   'С чем можно обращаться', NULL, 'textarea', true, '[]', 60, true),
  ('location',       'Где ты работаешь',       NULL, 'select', true, '["Москва", "Ереван"]', 70, true),
  ('work_format',    'Формат работы',          NULL, 'select', true, '["Пятидневка в офисе", "Гибрид", "Удалёнка"]', 80, true),
  ('telegram',       'Telegram',               'Без @', 'text', true, '[]', 90, true),
  ('email',          'Корпоративная почта',    NULL, 'text', false, '[]', 100, true),
  ('hobbies',        'Увлечения и таланты',    NULL, 'chips', true, '[]', 110, true),
  ('socials',        'Соцсети',                NULL, 'links', false, '[]', 120, false),
  ('photo',          'Фото',                   NULL, 'photo', true, '[]', 130, true)
ON CONFLICT (key) DO NOTHING;

-- Заявки сотрудников на изменение анкеты (модерация HR). Не более одной pending на пользователя.
CREATE TABLE IF NOT EXISTS trendsetter_hub.team_submissions (
  id             bigserial PRIMARY KEY,
  user_id        bigint NOT NULL REFERENCES trendsetter_hub.users (id) ON DELETE CASCADE,
  person_id      bigint REFERENCES trendsetter_hub.team_people (id) ON DELETE SET NULL,
  status         text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  values         jsonb NOT NULL DEFAULT '{}'::jsonb,
  photo_full     bytea,
  photo_thumb    bytea,
  review_comment text,
  reviewed_by    bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  reviewed_at    timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS team_submissions_one_pending_key ON trendsetter_hub.team_submissions (user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS team_submissions_status_idx ON trendsetter_hub.team_submissions (status, created_at);
