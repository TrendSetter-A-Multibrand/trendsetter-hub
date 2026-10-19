-- МОДУЛЬ «СКЛАД»: очистка тестовых данных перед переносом из Google Таблицы (WEEEK #18835, решение Q-M4).
-- Выполнять ОДИН раз под doadmin в базе defaultdb, ПЕРЕД боевым переносом (см. db/README.md, «Перенос данных из Google Таблицы»).
-- Удаляет ВСЕ данные Склада: приёмки, раскладки, сканы, короба, хранение и архив, доп. секции, коды ЧЗ, счётчики и указатели палетов.
-- НЕОБРАТИМО: после COMMIT вернуть данные можно только восстановлением базы. Не запускать, если на складе уже идёт живая работа в хабе.
-- Не трогает: users, audit_log и остальные таблицы ядра, структуру таблиц, другие схемы (только trendsetter_hub).
-- Всё в одной транзакции: при любой ошибке ничего не удаляется. Порядок — от зависимых таблиц к receipts (внешние ключи).
-- Если до этого уже был перенос через legacy_import, запись warehouse.legacy_import в audit_log останется
-- (журнал не трогаем); после очистки откат по ней невозможен и не нужен.

BEGIN;

DELETE FROM trendsetter_hub.warehouse_marks;
DELETE FROM trendsetter_hub.warehouse_storage_archive;
DELETE FROM trendsetter_hub.warehouse_storage_boxes;
DELETE FROM trendsetter_hub.warehouse_boxes;
DELETE FROM trendsetter_hub.warehouse_scans;
DELETE FROM trendsetter_hub.warehouse_receipt_plans;
DELETE FROM trendsetter_hub.warehouse_extra_sections;
DELETE FROM trendsetter_hub.warehouse_pallet_pointers;
DELETE FROM trendsetter_hub.warehouse_box_counters;
DELETE FROM trendsetter_hub.warehouse_receipts;

-- Проверка: везде должно быть 0 (иначе выполните ROLLBACK вместо COMMIT)
SELECT (SELECT count(*) FROM trendsetter_hub.warehouse_receipts) AS receipts,
       (SELECT count(*) FROM trendsetter_hub.warehouse_scans) AS scans,
       (SELECT count(*) FROM trendsetter_hub.warehouse_boxes) AS boxes,
       (SELECT count(*) FROM trendsetter_hub.warehouse_storage_boxes) AS storage_boxes,
       (SELECT count(*) FROM trendsetter_hub.warehouse_storage_archive) AS storage_archive,
       (SELECT count(*) FROM trendsetter_hub.warehouse_marks) AS marks,
       (SELECT count(*) FROM trendsetter_hub.warehouse_receipt_plans) AS receipt_plans,
       (SELECT count(*) FROM trendsetter_hub.warehouse_extra_sections) AS extra_sections,
       (SELECT count(*) FROM trendsetter_hub.warehouse_box_counters) AS box_counters,
       (SELECT count(*) FROM trendsetter_hub.warehouse_pallet_pointers) AS pallet_pointers;

COMMIT;
