-- МОДУЛЬ «СКЛАД» (приёмка по файлу). Таблицы в схеме trendsetter_hub с приставкой warehouse_.
-- Выполнять под doadmin в базе defaultdb ПОСЛЕ 01_core_hub.sql.
-- Соответствие листам Google Таблицы «Склад-приемка»:
--   Приемки → warehouse_receipts   Раскладки → warehouse_receipt_plans   Счётчики → warehouse_box_counters, warehouse_pallet_pointers
--   Сканы → warehouse_scans        Короба → warehouse_boxes              Хранение → warehouse_storage_boxes
--   Хранение — архив → warehouse_storage_archive    Секции → warehouse_extra_sections    Коды ЧЗ → warehouse_marks
--   Сводка → представление warehouse_receipt_summary (было формулами)
-- Сотрудник «Кто» (почта Google) теперь ссылка на trendsetter_hub.users; «Сотрудник» (фамилия, вписанная на ПК) — текст worker.

-- Приёмка = одна поставка. Название уникально без учёта регистра.
CREATE TABLE IF NOT EXISTS trendsetter_hub.warehouse_receipts (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'finished')), -- открыта / завершена
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_receipts_name_lower_key ON trendsetter_hub.warehouse_receipts (lower(name));

-- Общая раскладка приёмки (штрихкод → коробка), одна на приёмку, видна всем ПК. Версия растёт при замене файла.
CREATE TABLE IF NOT EXISTS trendsetter_hub.warehouse_receipt_plans (
  receipt_id  bigint PRIMARY KEY REFERENCES trendsetter_hub.warehouse_receipts (id) ON DELETE CASCADE,
  version     bigint NOT NULL,
  file_name   text NOT NULL,
  data        jsonb NOT NULL, -- вся раскладка целиком (в Google Таблице резалась кусками по 45 000 символов)
  uploaded_by bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  worker      text NOT NULL DEFAULT '',
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

-- Счётчики номеров коробов по категориям (BOX_05 → 05_0014). Инкремент — только через next_box_number().
CREATE TABLE IF NOT EXISTS trendsetter_hub.warehouse_box_counters (
  category    text PRIMARY KEY CHECK (category ~ '^[0-9A-Za-z-]+$'),
  last_number integer NOT NULL DEFAULT 0 CHECK (last_number >= 0)
);

-- Текущий заполняемый палет в каждой секции (PAL_<секция>)
CREATE TABLE IF NOT EXISTS trendsetter_hub.warehouse_pallet_pointers (
  section        text PRIMARY KEY,
  current_pallet smallint NOT NULL DEFAULT 1 CHECK (current_pallet BETWEEN 1 AND 6)
);

-- Номер короба одним действием, без дублей при работе с нескольких ПК
CREATE OR REPLACE FUNCTION trendsetter_hub.warehouse_next_box_number(p_category text) RETURNS integer
LANGUAGE sql AS $$
  INSERT INTO trendsetter_hub.warehouse_box_counters AS c (category, last_number) VALUES (p_category, 1)
  ON CONFLICT (category) DO UPDATE SET last_number = c.last_number + 1
  RETURNING last_number;
$$;

-- Закрытые короба. Код: S<секция>_K<категория>_P<палет>_<номер> (S01_K01_P1_0014).
CREATE TABLE IF NOT EXISTS trendsetter_hub.warehouse_boxes (
  code        text PRIMARY KEY,
  category    text NOT NULL,
  item_count  integer NOT NULL CHECK (item_count >= 0),
  worker      text NOT NULL DEFAULT '',
  opened_at   timestamptz,
  closed_at   timestamptz NOT NULL DEFAULT now(),
  closed_by   bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  receipt_id  bigint NOT NULL REFERENCES trendsetter_hub.warehouse_receipts (id)
);
CREATE INDEX IF NOT EXISTS warehouse_boxes_receipt_idx ON trendsetter_hub.warehouse_boxes (receipt_id);

-- Хранение: какой короб на каком палете (текущее состояние склада).
-- Секция = категория; в секции 6 палетов: 1–3 вмещают 16 коробов, 4–6 — 12 (проверяет приложение в транзакции).
CREATE TABLE IF NOT EXISTS trendsetter_hub.warehouse_storage_boxes (
  box_code    text PRIMARY KEY,                       -- один короб — одно место
  pallet_code text NOT NULL,                          -- S05_P2
  section     text NOT NULL,
  pallet_no   smallint NOT NULL CHECK (pallet_no BETWEEN 1 AND 6),
  item_count  integer NOT NULL CHECK (item_count >= 0),
  placed_at   timestamptz NOT NULL DEFAULT now(),
  worker      text NOT NULL DEFAULT '',
  placed_by   bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  receipt_id  bigint NOT NULL REFERENCES trendsetter_hub.warehouse_receipts (id),
  category    text NOT NULL,
  CHECK (pallet_code = 'S' || section || '_P' || pallet_no)
);
CREATE INDEX IF NOT EXISTS warehouse_storage_boxes_pallet_idx ON trendsetter_hub.warehouse_storage_boxes (pallet_code);
CREATE INDEX IF NOT EXISTS warehouse_storage_boxes_section_idx ON trendsetter_hub.warehouse_storage_boxes (section, pallet_no);

-- Короба освобождённых палетов
CREATE TABLE IF NOT EXISTS trendsetter_hub.warehouse_storage_archive (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  box_code    text NOT NULL,
  pallet_code text NOT NULL,
  section     text NOT NULL,
  pallet_no   smallint NOT NULL,
  item_count  integer NOT NULL,
  placed_at   timestamptz NOT NULL,
  worker      text NOT NULL DEFAULT '',
  placed_by   bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  receipt_id  bigint NOT NULL REFERENCES trendsetter_hub.warehouse_receipts (id),
  category    text NOT NULL,
  freed_at    timestamptz NOT NULL DEFAULT now(),
  freed_by    bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS warehouse_storage_archive_box_idx ON trendsetter_hub.warehouse_storage_archive (box_code);

-- Дополнительные секции категорий (основная секция = номер категории). Секция принадлежит одной категории.
CREATE TABLE IF NOT EXISTS trendsetter_hub.warehouse_extra_sections (
  section     text PRIMARY KEY,
  category    text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  CHECK (section <> category)
);
CREATE INDEX IF NOT EXISTS warehouse_extra_sections_category_idx ON trendsetter_hub.warehouse_extra_sections (category);

-- Реестр принятых кодов Честного знака: каждый КИ только один раз на весь склад.
-- Дубль определяется ошибкой вставки (INSERT ... ON CONFLICT DO NOTHING RETURNING), а не предварительным SELECT.
CREATE TABLE IF NOT EXISTS trendsetter_hub.warehouse_marks (
  ki          text PRIMARY KEY,
  gtin        text NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  worker      text NOT NULL DEFAULT '',
  user_id     bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  receipt_id  bigint REFERENCES trendsetter_hub.warehouse_receipts (id),
  box_category text,
  full_code   text,
  barcode     text
);
CREATE INDEX IF NOT EXISTS warehouse_marks_receipt_idx ON trendsetter_hub.warehouse_marks (receipt_id);

-- Сканы. id — идентификатор операции с клиента (W-<мс>-<случайное>): повторная отправка пачки не создаёт дублей.
-- box_code: пока короб открыт — временный номер 05_0014, при закрытии заменяется на итоговый S05_K05_P1_0014.
CREATE TABLE IF NOT EXISTS trendsetter_hub.warehouse_scans (
  id           text PRIMARY KEY,
  scanned_at   timestamptz NOT NULL,
  worker       text NOT NULL DEFAULT '',
  user_id      bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  receipt_id   bigint NOT NULL REFERENCES trendsetter_hub.warehouse_receipts (id),
  box_category text NOT NULL,        -- коробка по раскладке (20 — нет в файле / излишек)
  box_code     text NOT NULL,
  barcode      text NOT NULL,
  status       text NOT NULL CHECK (status IN ('ok', 'unknown', 'extra', 'foreign')), -- в файле / нет в файле / излишек / чужой код ЧЗ
  no_cz        boolean NOT NULL DEFAULT false,                                          -- принят в режиме «Скан без ЧЗ»
  ki           text,
  full_code    text
);
CREATE INDEX IF NOT EXISTS warehouse_scans_receipt_idx ON trendsetter_hub.warehouse_scans (receipt_id, scanned_at);
CREATE INDEX IF NOT EXISTS warehouse_scans_box_idx ON trendsetter_hub.warehouse_scans (box_code);
CREATE INDEX IF NOT EXISTS warehouse_scans_ki_idx ON trendsetter_hub.warehouse_scans (ki) WHERE ki IS NOT NULL;

-- Сводка по приёмке (в Google Таблице считалась формулами)
CREATE OR REPLACE VIEW trendsetter_hub.warehouse_receipt_summary AS
SELECT
  r.id AS receipt_id,
  r.name AS receipt,
  r.status,
  count(s.id) AS scanned,
  count(s.id) FILTER (WHERE s.status IN ('unknown', 'foreign')) AS not_in_file,
  count(s.id) FILTER (WHERE s.status = 'extra') AS surplus,
  (SELECT count(*) FROM trendsetter_hub.warehouse_boxes b WHERE b.receipt_id = r.id) AS boxes_closed,
  min(s.scanned_at) AS started_at,
  max(s.scanned_at) AS last_scan_at,
  (SELECT count(*) FROM trendsetter_hub.warehouse_boxes b
     WHERE b.receipt_id = r.id
       AND NOT EXISTS (SELECT 1 FROM trendsetter_hub.warehouse_storage_boxes sb WHERE sb.box_code = b.code)) AS boxes_without_pallet,
  (SELECT count(DISTINCT sb.pallet_code) FROM trendsetter_hub.warehouse_storage_boxes sb WHERE sb.receipt_id = r.id) AS pallets,
  count(s.id) FILTER (WHERE s.ki IS NOT NULL) AS cz_codes,
  count(s.id) FILTER (WHERE s.no_cz) AS marked_without_cz
FROM trendsetter_hub.warehouse_receipts r
LEFT JOIN trendsetter_hub.warehouse_scans s ON s.receipt_id = r.id
GROUP BY r.id, r.name, r.status;

GRANT SELECT ON trendsetter_hub.warehouse_receipt_summary TO hub_app;
GRANT EXECUTE ON FUNCTION trendsetter_hub.warehouse_next_box_number(text) TO hub_app;
