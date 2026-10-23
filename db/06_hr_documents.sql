-- ШАГ 6. HR: документы сотрудника (ревизия Alembic 0006).
-- Выполнять под doadmin, подключившись к базе defaultdb ПОСЛЕ 05_hr_dossier.sql. Скрипт можно запускать повторно.
-- Права для hub_app выдаются автоматически (ALTER DEFAULT PRIVILEGES в 01_core_hub.sql).
-- Файлы хранятся в БД (bytea) отдельной таблицей, чтобы список документов не читал содержимое. Доступ — только responsible на hr.
-- Имена файлов и содержимое в журнал не пишутся. TODO(Q-D3): шифрование на уровне приложения не делаем.

CREATE TABLE IF NOT EXISTS trendsetter_hub.hr_documents (
  id          bigserial PRIMARY KEY,
  person_id   bigint NOT NULL REFERENCES trendsetter_hub.team_people (id) ON DELETE CASCADE,
  category    text NOT NULL CHECK (category IN ('contract', 'order', 'id_doc', 'tax', 'bank', 'medical', 'other')),
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  file_name   text NOT NULL,
  mime        text NOT NULL,
  size_bytes  integer NOT NULL,
  uploaded_by bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_documents_person_idx ON trendsetter_hub.hr_documents (person_id, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS trendsetter_hub.hr_document_files (
  document_id bigint PRIMARY KEY REFERENCES trendsetter_hub.hr_documents (id) ON DELETE CASCADE,
  content     bytea NOT NULL
);
