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

## Модули «HR» и «Карта команды»
`03_hr_team_modules.sql` (ревизия `0003`): отдел `hr` и привязка модуля `hr` к нему. Модуль `team` привязки не имеет: он помечен `for_all` в манифесте бэкенда и виден всем активным сотрудникам (просмотр). Порядок выката как у группы доступа: под doadmin `db/03_hr_team_modules.sql`, затем `deploy/stamp_alembic_0003.sql` (`0002` → `0003`), только потом merge в `main`.

## Модуль «Карта команды» (team)
`04_team.sql` (ревизия `0004`): `team_directions` (справочник направлений, цвета по брендбуку, включая `leadership`), `team_people` (карточки; ответы анкеты — JSONB `answers`), `team_photos` (фото в БД, `photo_full`/`photo_thumb`), `team_form_fields` (поля анкеты для конструктора HR, сид 13 полей), `team_submissions` (заявки сотрудников на модерацию, не более одной `pending` на пользователя). Людей скрипт не создаёт: персональные данные в git не хранятся.

**Порядок выката** (как у `0003`; `deploy.sh` миграции не выполняет):
1. Под doadmin в `defaultdb` выполнить `db/04_team.sql`.
2. Под doadmin выполнить `deploy/stamp_alembic_0004.sql` (версия миграции `0003` → `0004`).
3. Только после этого — merge в `main`. Иначе деплой будет «зелёным», а `/core/me` и модуль `team` начнут отвечать 500.

**Откат миграции** (`alembic downgrade 0003`): удаляются только таблицы `team_*`.

**Загрузка людей из `team.json`** (разово, вне репозитория; файл с ПДн положить на сервер как xlsx склада, `chmod 600`, после загрузки удалить):
```
docker exec -i trendsetter-hub-api python -m app.modules.team.seed - < /opt/trendsetter-hub/import/team.json            # сухой прогон
docker exec -i trendsetter-hub-api python -m app.modules.team.seed - --apply < /opt/trendsetter-hub/import/team.json    # запись
docker exec trendsetter-hub-api python -m app.modules.team.seed --rollback [--apply]                                    # откат
```
Сухой прогон по умолчанию. Коды выхода: 0 — успех; 1 — ошибки файла/БД; 2 — в `team_people` уже есть карточки (загрузка) или началась живая работа (откат). В выводе и журнале только счётчики и id из файла, почты и telegram не печатаются.

**Перенос ответов старой Google-формы в карточки** (разово, после загрузки людей; код — `backend/app/modules/team/import_responses.py`). Папка с ПДн лежит вне репозитория: `responses.xlsx` (лист «Ответы на форму»), `emails.xlsx` (лист Sheet1: «Имя» латиницей, «Почта»), `photos/<driveId>.full.jpg` и `<driveId>.thumb.jpg` (JPEG, full ≤ 300 КБ, thumb ≤ 30 КБ), необязательный `aliases.json` (`{"Зимина Лиза": "Зимина Елизавета"}`: «Фамилия Имя» из ответа → «Фамилия Имя» карточки).
```
docker cp <папка> trendsetter-hub-api:/tmp/team-import
docker exec -u root trendsetter-hub-api chmod -R a+rX /tmp/team-import
docker exec trendsetter-hub-api python -m app.modules.team.import_responses /tmp/team-import --aliases /tmp/team-import/aliases.json            # сухой прогон
docker exec trendsetter-hub-api python -m app.modules.team.import_responses /tmp/team-import --aliases /tmp/team-import/aliases.json --apply    # запись
docker exec -u root trendsetter-hub-api rm -rf /tmp/team-import                                                                                  # удалить папку из контейнера
```
`--aliases` можно не указывать. Необязательный `--dismissed dismissed.json` (`{"Вардересян Гоар": "mkt"}`: «Фамилия Имя» как в ответе формы → id направления из `team_directions`) создаёт карточки уволенных, которых нет ни среди неархивных, ни среди архивных: архивная (`is_archived=true`, `show_in_map=false`, без руководителя, `sort` в конец), имя/фамилия/должность из последнего ответа формы (в `responses.xlsx` нужен столбец «Твоя должность»), дальше заполняется как обычная (анкета, фото, почта из ответа или `emails.xlsx`). Архивные карточки с именами из `dismissed.json` (и только они) участвуют в сопоставлении ответов и почт; остальные архивные — нет. Неизвестное направление или битый файл — код 1, ничего не записано; ключ без ответа в форме не создаётся (в выводе счётчик). Повторный запуск не создаёт дублей. В выводе — только «Создано уволенных: N». Алиасы работают и для имён из `emails.xlsx`: ключ может быть латинским (`"Sonya Vorobyeva": "Воробьёва Софья"`), такой алиас приоритетнее транслита. Сухой прогон по умолчанию (одна транзакция, ROLLBACK); `--apply` пишет одной транзакцией; повторный запуск безопасен. Ответ сопоставляется с неархивной карточкой по множеству слов «фамилия + имя» (порядок, регистр и ё/е не важны), иначе по алиасам; не нашли или неоднозначно — в отчёте только номер строки Excel и причина. Пишется только пустое: имя, фамилия, должность, руководитель, направление, тег, команда, `show_in_map`, `user_id` не меняются; почта берётся из ответа, иначе из `emails.xlsx` (нечёткое сравнение с транслитом карточки, нужен однозначный лидер); фото — только если у карточки его нет. Если один человек ответил дважды, побеждает последняя строка. Коды выхода: 0 — успех / чистый сухой прогон; 1 — ошибки входных файлов (нет файла, листа, столбцов, битый `aliases.json`); 2 — конфликт БД. В выводе и журнале (`team.import_responses`) только счётчики и номера строк; имена, почты, telegram и тексты не печатаются. Лимит одного чипа «Увлечения и таланты» поднят с 60 до 400 символов (`service.CHIP_LIMIT`), чтобы импортированные фразы можно было править в анкете.

## HR-досье, отпуска, уведомления (ревизия 0005)
`05_hr_dossier.sql`: `user_module_permissions` (личные права `view`/`run`/`responsible` на модуль, итог с групповыми — максимум), `notifications` (уведомления хаба), `hr_leave_policies` (нормы по странам RU/AM: 28 дней, 2,333 в месяц; для RU право на первый отпуск через 6 месяцев), `hr_employee_files` (базовое досье, право `run` на hr), `hr_employee_sensitive` (деньги и документы, только `responsible`), `hr_leave_adjustments`, `hr_leave_requests`, а также поле анкеты `video_link` в `team_form_fields`. Значения денег и документов в журнал не пишутся; шифрования на уровне приложения нет (TODO Q-D3).

**Выкат 0005** (как у `0004`; `deploy.sh` миграции не выполняет):
1. Под doadmin в `defaultdb` выполнить `db/05_hr_dossier.sql`.
2. Под doadmin выполнить `deploy/stamp_alembic_0005.sql` (версия миграции `0004` → `0005`).
3. Только после этого — merge в `main`. Иначе деплой будет «зелёным», а `/core/me` и модуль `hr` начнут отвечать 500.
4. В админке («Пользователи» → «Особые права») поставить `responsible` на `hr` нужным людям (admin/superuser ответственными автоматически не считаются).

**Откат** (`alembic downgrade 0004`): удаляются только таблицы `user_module_permissions`, `notifications`, `hr_*` и строка `video_link`.

## HR: документы сотрудника (ревизия 0006)
`06_hr_documents.sql`: `hr_documents` (метаданные: категория, название, имя файла, mime, размер, кто и когда загрузил; каскад от `team_people`) и `hr_document_files` (содержимое `bytea` отдельно, чтобы список не читал файлы). Файлы хранятся в БД, S3 нет; все операции — только право `responsible` на `hr`. В журнал пишутся id документа/человека и категория, без имён файлов и содержимого. Размер файла ограничен 8 МБ на уровне приложения (следить за ростом БД).

**Выкат 0006** (как у `0005`; `deploy.sh` миграции не выполняет):
1. Под doadmin в `defaultdb` выполнить `db/06_hr_documents.sql` (после `05_hr_dossier.sql`).
2. Под doadmin выполнить `deploy/stamp_alembic_0006.sql` (версия миграции `0005` → `0006`).
3. Только после этого — merge в `main`. Иначе деплой будет «зелёным», а документы сотрудника начнут отвечать 500.

**Откат** (`alembic downgrade 0005`): удаляются только таблицы `hr_document_files` и `hr_documents`.

## HR: напоминания, история, оборудование, чек-листы, график отпусков (ревизия 0007)
`07_hr_people_ops.sql`: столбцы `hr_employee_files.birthday_hidden` и `hr_documents.visible_to_employee`; таблицы `hr_reminder_log` (отметки «напоминание создано», PK `day, kind, person_id`, для событий без человека `person_id = 0`), `hr_employee_history`, `hr_equipment`, `hr_checklist_templates` и `hr_checklist_template_items` (сид: «Онбординг: новый сотрудник» и «Оффбординг: увольнение»; повторный запуск шаблоны не дублирует), `hr_checklists` и `hr_checklist_items`, `hr_leave_plans`. Напоминания создаются без cron: при обращении к `/core/me` (не чаще раза в сутки). В журнал пишутся только id и категории. «Мои документы» работают только для карточки, привязанной к аккаунту (`team_people.user_id`): HR привязывает аккаунт в карточке, либо сотрудник отправляет анкету.

**Выкат 0007** (как у `0006`; `deploy.sh` миграции не выполняет):
1. Под doadmin в `defaultdb` выполнить `db/07_hr_people_ops.sql` (после `06_hr_documents.sql`).
2. Под doadmin выполнить `deploy/stamp_alembic_0007.sql` (версия миграции `0006` → `0007`).
3. Только после этого — merge в `main`. Иначе деплой будет «зелёным», а `/core/me` и модуль `hr` начнут отвечать 500 (напоминания) или новые разделы HR будут недоступны.

**Откат** (`alembic downgrade 0006`): удаляются только новые таблицы `hr_leave_plans`, `hr_checklist_*`, `hr_equipment`, `hr_employee_history`, `hr_reminder_log` и два новых столбца.

## Безопасность: смена пароля, журнал, шифрование (ревизия 0008)
`08_security.sql`: столбец `users.token_version` (смена/сброс пароля увеличивает его, прежние токены перестают действовать; токены без `tv` считаются `tv=0`) и два индекса `audit_log` (`action, at DESC` и `details->>'person_id'`). Новых таблиц нет. Шифрование ПДн (Fernet, `HUB_PII_KEY`) работает в приложении и структуру БД не меняет; оклад (`numeric`) не шифруется (TODO Q-S1). Подробности — `docs/TZ-security.md`.

**Выкат 0008** (как у `0007`; `deploy.sh` миграции не выполняет):
1. Положить `HUB_PII_KEY` в `/opt/trendsetter-hub/.env` на сервере (ключ создаётся там же: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`, не показывать и не коммитить). Резервная копия ключа — в менеджере паролей владельца: потеря ключа = потеря зашифрованных данных.
2. Под doadmin в `defaultdb` выполнить `db/08_security.sql` (после `07_hr_people_ops.sql`).
3. Под doadmin выполнить `deploy/stamp_alembic_0008.sql` (версия миграции `0007` → `0008`).
4. Только после этого — merge в `main`. Иначе деплой будет «зелёным», а вход и любые запросы с токеном начнут отвечать 500 (нет столбца `token_version`).
5. После деплоя в контейнере API: `python -m app.modules.hr.encrypt_existing` (сухой прогон, только счётчики), затем `python -m app.modules.hr.encrypt_existing --apply` — шифрует уже загруженные документы и значения досье. Команда безопасна для повторного запуска.

**Откат** (`alembic downgrade 0007`): удаляются только столбец `users.token_version` и два индекса журнала. Зашифрованные данные при откате кода без ключа не читаются — ключ хранить.

## Новости компании (ревизия 0009)
`09_news.sql`: таблицы `news_items` (новости и события; для события — начало, окончание, место, голосование «Кто пойдёт», настройка `rsvp_names_public` — видят ли имена все читатели), `news_rsvp` (ответ «Иду / Думаю / Не иду», один на человека и событие) и `news_banners` (срочная плашка над главной). Права hub_app — автоматически (`ALTER DEFAULT PRIVILEGES` из `01_core_hub.sql`). Привязок к отделам нет: модуль `news` для всех, скрыт из меню.

**Правило плашки:** активна не больше одной (частичный уникальный индекс `news_banners_one_active`). Новый текст создаёт новую строку с новым `id` (кто скрыл прежнюю, увидит новую); смена только даты окончания `id` не меняет; повторное включение после «Выключить» тоже создаёт новую строку.

**Права:** «Редактор новостей» = право «Ответственный» на модуле «Новости» (Профиль → «Пользователи и отделы» → «Особые права», либо группа доступа) или администратор. Отдельных таблиц и столбцов прав нет.

**Выкат 0009** (как у `0008`; `deploy.sh` миграции не выполняет):
1. Под doadmin в `defaultdb` выполнить `db/09_news.sql` (после `08_security.sql`).
2. Под doadmin выполнить `deploy/stamp_alembic_0009.sql` (версия миграции `0008` → `0009`).
3. Только после этого — merge в `main`. Иначе `/modules/news/*` отвечает 500.
4. Выдать «Ответственный» на «Новости» ассистенту-редактору в «Особых правах».

**Откат** (`alembic downgrade 0008`): удаляются только таблицы `news_rsvp`, `news_items`, `news_banners`. Строки `module_id='news'` в `user_module_permissions` и `access_group_permissions` не удаляются (безвредны: интерфейс перечисляет только модули из реестра; при повторном upgrade редакторы сохраняются).

## WB, раздел «Маркировка» (ревизия 0010)
`modules/wb/001_wb_marking.sql`: таблица `wb_marking_documents` — номер документа «Честного ЗНАКа», внесённый в хабе по строке сверки (`item_key` = `<withdraw|return>:<srid>:<код маркировки>`). Сами отчёты WB (`api_wb_FinanceReport`, `api_wb_Orders_FBS`, `api_wb_ExciseReport`) остаются в схеме `public`, хаб их только читает отдельным подключением `HUB_WB_DATABASE_URL`.

**Выкат 0010** (как у `0009`):
1. Под doadmin в `defaultdb` выполнить `db/modules/wb/001_wb_marking.sql`, затем `deploy/stamp_alembic_0010.sql` (`0009` → `0010`).
2. Пользователь только для чтения отчётов (не `doadmin` и не общий `claude_ro`), например:
   `CREATE ROLE hub_wb_ro LOGIN PASSWORD '<пароль>'; GRANT USAGE ON SCHEMA public TO hub_wb_ro;`
   `GRANT SELECT ON public."api_wb_FinanceReport", public."api_wb_Orders_FBS", public."api_wb_ExciseReport" TO hub_wb_ro;`
   (последняя таблица — после первого запуска загрузчика api_wb_ExciseReport).
3. Индекс по дате продажи — без него запрос сверки упирается в таймаут:
   `CREATE INDEX CONCURRENTLY IF NOT EXISTS "api_wb_FinanceReport_sale_dt_idx" ON public."api_wb_FinanceReport" (sale_dt);`
4. В окружении сервера задать `HUB_WB_DATABASE_URL` (см. `backend/.env.example`). Без него «Маркировка» отвечает 503.
5. Только после этого — merge в `main`.

**Откат** (`alembic downgrade 0009`): удаляется только `wb_marking_documents`.

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
