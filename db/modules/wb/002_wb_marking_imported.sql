-- WB «Маркировка»: коды, уже выведенные из оборота / возвращённые в оборот вне хаба — загрузка из Excel (ревизия Alembic 0013).
-- Выполнять под doadmin в базе defaultdb ПОСЛЕ 001_wb_marking.sql. Скрипт можно запускать повторно.
-- Связь со строками сверки — по списку и коду маркировки (в файле нет srid). Номер, внесённый в хабе по строке, важнее загруженного.

CREATE TABLE IF NOT EXISTS trendsetter_hub.wb_marking_imported (
  list        text NOT NULL CHECK (list IN ('withdraw', 'return')),
  km          text NOT NULL CHECK (char_length(km) BETWEEN 18 AND 200),  -- короткий код: 01 + GTIN + 21 + серийный номер
  document    text NOT NULL CHECK (char_length(document) BETWEEN 1 AND 100),
  imported_by bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list, km)
);
