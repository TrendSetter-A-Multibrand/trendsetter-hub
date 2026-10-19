# База данных хаба (PostgreSQL, DigitalOcean)

SQL-скрипты для базы хаба. Секретов (паролей) в них нет.

## Как это устроено — простыми словами
Кластер DO `db-postgresql-fra1-45348` содержит базы (`defaultdb`, `purchasing_dashboard`, `airflow_db`). Внутри базы бывают **схемы** — «ящики» для таблиц одного проекта. В `defaultdb` уже лежат схемы `procurement`, `meta`, `public`. По решению руководителя хаб получает свою схему в `defaultdb`:

| Уровень | Что это | Пример |
|---|---|---|
| **база** | «сейф» | `defaultdb` |
| **схема** | «ящик» хаба; закупки и остальное в соседних ящиках, мы их не трогаем | `trendsetter_hub` |
| **таблица** | сами данные | `trendsetter_hub.users`, `trendsetter_hub.warehouse_scans` |

Таблицы ядра называются просто (`users`, `departments`, `audit_log`…). Таблицы модуля начинаются с имени модуля: `warehouse_scans`, `warehouse_boxes`; будущие модули — `purchasing_…`, `wb_…`. Так в одной схеме сразу видно, чьи это таблицы, и новый модуль добавляется новыми таблицами с новой приставкой.

Приложение подключается отдельным пользователем `hub_app`: читает и пишет данные в схеме `trendsetter_hub`, не меняет структуру и не видит схему `procurement`. Структуру меняет только `doadmin` через эти скрипты. Бэкенду нужен `search_path=trendsetter_hub`.

## Что сделать вручную (DBeaver или pgAdmin, под doadmin, база defaultdb)
1. **Пользователь `hub_app`.** Панель DO → кластер → Users & Databases → Add new user → `hub_app`. Пароль сохраните в менеджере паролей (файл `00_database_and_roles.sql` — только если делать через SQL).
2. **`01_core_hub.sql`** — создаёт схему `trendsetter_hub` и таблицы ядра (отделы, пользователи, доступ, журнал). Выполнить как скрипт (в DBeaver Alt+X).
3. **`modules/warehouse/001_warehouse.sql`** — таблицы модуля «Склад».

4. **`02_access_groups.sql`** — группы доступа (см. ниже).

Скрипты можно запускать повторно: существующее они пропускают. Ничего вне схемы `trendsetter_hub` они не меняют.

## Ядро
`departments` (отделы — справочник), `users` (вход по почте и паролю; пароль только хэшем; уровни admin / superuser / employee / viewer), `user_departments`, `module_departments`, `audit_log`. Первого администратора создаёт команда бэкенда (пароли в SQL не хранятся).

## Группы доступа
`access_groups` (название, уникальное без учёта регистра), `access_group_permissions` (на пару «группа — модуль» одно право: `view` / `run` / `responsible`), `access_group_members` (участники). Права группы только добавляются к уровню и отделам сотрудника (итог — максимум); удаления групп нет, группу можно обнулить. Таблицы без приставки модуля, одна ревизия Alembic `0002`.

**Порядок выката (боевая база; `deploy.sh` миграции не выполняет, `/health` базу не проверяет):**
1. Под doadmin в `defaultdb` выполнить `db/02_access_groups.sql`.
2. Под doadmin выполнить `deploy/stamp_alembic_0002.sql` (версия миграции `0001` → `0002`).
3. Только после этого — merge в `main`. Иначе деплой будет «зелёным», а `/core/me` и Склад начнут отвечать 500.

## Модуль «Склад»
Листы Google Таблицы «Склад-приёмка» стали таблицами: Приемки → `warehouse_receipts`, Раскладки → `warehouse_receipt_plans`, Счётчики → `warehouse_box_counters` и `warehouse_pallet_pointers`, Сканы → `warehouse_scans`, Короба → `warehouse_boxes`, Хранение → `warehouse_storage_boxes`, Хранение — архив → `warehouse_storage_archive`, Секции → `warehouse_extra_sections`, Коды ЧЗ → `warehouse_marks`, Сводка → представление `warehouse_receipt_summary`. Условия, которые раньше защищал `LockService`, держит база: уникальность кода ЧЗ, одно место на короб, уникальное имя приёмки, номера коробов через функцию `warehouse_next_box_number()`, повтор отправки скана отсекается по id.

## Перенос данных из Google Таблицы (разово)
Команда `python -m app.modules.warehouse.legacy_import` (код — `backend/app/modules/warehouse/legacy_import.py`, WEEEK #18835) переносит выгрузку xlsx старой системы «Склад-приемка» в таблицы `warehouse_*`. Работает в контейнере API под `hub_app`, к HTTP не подключена, DDL и миграций нет.

**Соответствие листов.** Приемки → `warehouse_receipts`; Раскладки (части склеиваются по «Часть») → `warehouse_receipt_plans`; Счётчики → `warehouse_box_counters` (`BOX_xx`, берётся максимум из листа и номеров всех кодов, включая временные) и `warehouse_pallet_pointers` (`PAL_xx`); Сканы → `warehouse_scans`; Короба → `warehouse_boxes`; Хранение → `warehouse_storage_boxes`; Хранение — архив → `warehouse_storage_archive`; Секции → `warehouse_extra_sections`; Коды ЧЗ → `warehouse_marks`. Столбец «Кто» (почта) сопоставляется с `users` без учёта регистра; нет такой почты в хабе — ошибка, учётки заводит админ заранее.

**Не переносится.** Сводка (в хабе её заменяет представление `warehouse_receipt_summary`, лист используется только для сверки); Раскладка и Лист 1 (пустые); раскладка завершённой приёмки (хаб удаляет её при завершении); формульный столбец «Палет» в Сканах и Коробах. 8 полностью одинаковых строк «Короба» схлопываются в одну (в хабе у «Новой Моды» 416 коробов против 424 в Сводке — отчёт объясняет расхождение). Метка источника без DDL: запись `warehouse.legacy_import` в `audit_log`.

**Режимы и коды выхода.** Без флагов — сухой прогон (тот же путь, в конце ROLLBACK). `--apply` — запись одной транзакцией. `--rollback` — откат последнего переноса (по умолчанию тоже сухой, `--rollback --apply` — удаление; возможен только до начала живой работы). `--tz` — часовой пояс листов, по умолчанию `Europe/Moscow` (проверяется самопроверкой по ID сканов и версиям раскладок). Файл — путь или `-` (stdin). Коды выхода: 0 — успех / чистый сухой прогон; 1 — ошибки файла (в том числе неизвестные почты и часовой пояс); 2 — конфликт с данными БД или откат невозможен; 3 — сверка со Сводкой или с представлением не сошлась. КИ в выводе и журнале только маской, `full_code` и почты не печатаются.

**Порядок боевого выката** (шаги 0–9 — по ТЗ `docs/TZ-warehouse-legacy-import.md`; шаг 3а добавлен по решению Q-M4):
0. Ответить на Q-M1…Q-M9. Merge в `main` → автодеплой. Миграций нет, stamp не нужен. Проверить:
   ```
   docker exec trendsetter-hub-api python -c "import openpyxl, app.modules.warehouse.legacy_import"
   ```
1. В админке хаба завести пользователей с почтами из «Кто» (Q-M1).
2. **Заморозка старой системы:**
   - все ПК закрывают открытые короба и онлайн отправляют очереди;
   - сканирование останавливается;
   - владелец переводит Google Таблицу в «только чтение» (Q-M9);
   - «Файл → Скачать → xlsx».
3. На сервер (вне репозитория):
   ```
   ssh … 'install -d -m 700 /opt/trendsetter-hub/import'
   scp sklad.xlsx …:/opt/trendsetter-hub/import/sklad.xlsx
   chmod 600 /opt/trendsetter-hub/import/sklad.xlsx
   ```
3а. **Очистка тестовых данных Склада (Q-M4).** Владелец БД под doadmin в `defaultdb` выполняет `db/modules/warehouse/cleanup_test_data.sql` (удаляет все данные `warehouse_*`, необратимо; `users` и `audit_log` не трогает). Иначе сухой прогон вернёт код 2.
4. Сухой прогон:
   ```
   docker exec -i trendsetter-hub-api python -m app.modules.warehouse.legacy_import - < /opt/trendsetter-hub/import/sklad.xlsx
   ```
   Ожидается exit 0. Предупреждение о временных коробах — около 0 (было 482). Exit 2 — в БД есть тестовые данные (Q-M4).
5. Перед записью запомнить время (запасной вариант — восстановление DO на момент времени).
6. Запись:
   ```
   docker exec -i trendsetter-hub-api python -m app.modules.warehouse.legacy_import - --apply < /opt/trendsetter-hub/import/sklad.xlsx
   ```
   Ожидается exit 0, сверка «OK» по обеим приёмкам. Сохранить вывод (без КИ).
7. Проверка в интерфейсе — **только просмотр**:
   - список приёмок (открыта «Новая Мода»);
   - раскладка подтягивается;
   - «Хранение» — 433 короба, 36 палетов.
   - Не выдавать номера коробов и не закрывать короба до решения «откат не нужен»: любая живая операция делает автоматический откат невозможным.
   - Учесть: секции 01, 03, 15 заполнены, новые короба категорий 01 и 03 пойдут в доп. секции.
8. Удалить файл: `shred -u /opt/trendsetter-hub/import/sklad.xlsx`. В контейнер файл не попадал. Локальная копия остаётся только в `modules/warehouse/` (в `.gitignore`).
9. Открыть работу склада в хабе.

**Откат** (только до первой живой операции):
```
docker exec trendsetter-hub-api python -m app.modules.warehouse.legacy_import --rollback           # сухой прогон
docker exec trendsetter-hub-api python -m app.modules.warehouse.legacy_import --rollback --apply
```
Файл не нужен. После начала живой работы — только ручное решение: восстановление DO на момент времени с потерей живых данных.

**Проверочные SQL** (необязательно; выполняет владелец БД по принятой практике этого файла, только чтение; основная проверка — отчёт команды):
```sql
SELECT * FROM trendsetter_hub.warehouse_receipt_summary ORDER BY receipt;
SELECT r.name, count(*) FILTER (WHERE s.box_code !~ '^S') AS scans_in_open_boxes
  FROM trendsetter_hub.warehouse_scans s JOIN trendsetter_hub.warehouse_receipts r ON r.id = s.receipt_id GROUP BY r.name;
SELECT (SELECT count(*) FROM trendsetter_hub.warehouse_marks) AS marks,
       (SELECT count(*) FROM trendsetter_hub.warehouse_scans WHERE ki IS NOT NULL) AS scans_with_ki,
       (SELECT count(*) FROM trendsetter_hub.warehouse_storage_boxes) AS storage,
       (SELECT count(*) FROM trendsetter_hub.warehouse_boxes) AS boxes;
SELECT category, last_number FROM trendsetter_hub.warehouse_box_counters ORDER BY category;
SELECT section, current_pallet FROM trendsetter_hub.warehouse_pallet_pointers ORDER BY section;
SELECT pallet_code, count(*) FROM trendsetter_hub.warehouse_storage_boxes GROUP BY 1 HAVING count(*) > 16;  -- ожидается пусто
SELECT id, at, details->'receipts', details->>'file_sha256' FROM trendsetter_hub.audit_log
 WHERE action LIKE 'warehouse.legacy_import%' ORDER BY id;
```

## Как добавить новый модуль
Скопируйте `modules/_template.sql` в `db/modules/<имя>/001_<имя>.sql`, назовите таблицы `<имя>_…`, выполните на `defaultdb`. Права для `hub_app` на новые таблицы схемы выдаются автоматически.

## Дальше
Когда появится бэкенд, эти скрипты станут первой ревизией Alembic (правило проекта: структуру меняет только Alembic). До этого изменения структуры — новыми файлами в этой папке, по номерам. Подключаться к боевой базе с машины разработчика для работы над кодом нельзя: для разработки используется локальный Postgres из docker compose. Правило проекта «своя база для хаба» заменено решением руководителя: схема `trendsetter_hub` в `defaultdb`.
