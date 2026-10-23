# ТЗ: HR — напоминания и дни рождения, экспорт, история, онбординг/оффбординг, оборудование, годовой график отпусков, свои документы

Статус: решения согласованы с пользователем 2026-10-23, ветка `dev-karen`. Один пакет — **одна** ручная миграция БД (`0007`). Контракт заморожен; backend, mock и фронт делаются по нему. Продолжает `docs/TZ-hr-dossier.md` (досье, деньги, отпуска, уведомления, документы) и `docs/TZ-team-map.md`. Любое отступление — открытый вопрос (`TODO(Qn)`), не молчаливое решение.

## Решения (не пересматривать)
1. **Напоминания без cron на сервере.** Общий механизм ядра: `ModuleManifest.daily_job: Callable[[Session], None] | None`; `/core/me` (и только он) вызывает задачи модулей не чаще раза в сутки: перед запуском `pg_try_advisory_xact_lock`, отметка дня в `hr_reminder_log` (PK `day, kind, person_id`) делает повторные запуски безвредными (ON CONFLICT DO NOTHING + создаём уведомление только при успешной вставке). Исключения задачи не ломают `/core/me` (ловятся и пишутся в лог без ПДн).
2. **Что напоминаем (получатели: все с `run` на `hr`):** `probation_ending` — `probation_until` через 14 и 3 дня и в день окончания; `work_anniversary` — годовщина `hired_at` (1, 3, 5, 10 лет) в день; `birthday` — день рождения сегодня (HR + руководитель); `equipment_return_due` — `return_due` через 3 дня и в день; `checklist_overdue` — просроченный пункт чек-листа (раз в день, не чаще). Тексты без лишних ПДн (ФИО + событие), ссылка на `/modules/hr`.
3. **Дни рождения.** Видны всем, у кого `team` ≥ view и не `structure`, только день и месяц (без года и возраста): `GET /modules/hr/birthdays`. HR может скрыть конкретного человека (`birthdayHidden`). Берутся неархивные карточки с `show_in_map`.
4. **Экспорт в Excel** (`.xlsx`, openpyxl уже в зависимостях): только для `run` на `hr`; ответ JSON `{fileName, dataBase64}` (транспорт умеет только JSON). **Деньги и документы в экспорт не попадают никогда.**
5. **История** фиксирует перемещения/должность/руководителя/направление/статус автоматически при правках `PATCH /hr/people/{id}` и вручную. Записи типа `salary` (изменение оклада) видит и создаёт только `responsible`; остальные — `run`.
6. **Онбординг/оффбординг** — чек-листы по шаблонам (шаблоны правит HR). Пункты можно назначать пользователям хаба (уведомление при назначении), отмечать выполненными; когда все пункты выполнены — уведомление HR. При «Отметить уволенным» интерфейс предлагает запустить оффбординг (на фронте, без автозапуска на бэкенде).
7. **Оборудование** — учёт выданного (вид, название, серийный номер, дата выдачи, срок возврата, дата возврата).
8. **Годовой график отпусков.** Сотрудник вносит плановые периоды на год (`hr_leave_plans`); руководитель видит план своих подчинённых; HR — все. Из планового периода одним действием создаётся заявка на отпуск (обычный поток согласования). Нагрузка по месяцам и направлениям считается на фронте из ответа HR-эндпоинта; жёстких запретов нет (только подсветка).
9. **Свои документы.** У документа флаг `visible_to_employee` (по умолчанию false). Сотрудник видит и скачивает только отмеченные документы своей карточки. Права на загрузку/удаление/смену флага — прежние (`responsible`).

## Данные (db/07_hr_people_ops.sql, Alembic 0007, deploy/stamp_alembic_0007.sql)
Схема `trendsetter_hub`, идемпотентно (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO NOTHING`). Все таблицы с `hr_`, FK на `team_people`/`users` как в `db/05_hr_dossier.sql`.
- `ALTER TABLE hr_employee_files ADD COLUMN IF NOT EXISTS birthday_hidden boolean NOT NULL DEFAULT false`.
- `ALTER TABLE hr_documents ADD COLUMN IF NOT EXISTS visible_to_employee boolean NOT NULL DEFAULT false`.
- `hr_reminder_log(day date, kind text, person_id bigint NULL, PRIMARY KEY (day, kind, person_id))` — для событий без человека `person_id = 0` (PK не допускает NULL; FK не нужен).
- `hr_employee_history(id bigserial, person_id → team_people CASCADE, kind text CHECK IN ('position','salary','manager','direction','status','other'), effective_date date NOT NULL, title text NOT NULL (1–200), old_value text NULL, new_value text NULL, comment text NULL, auto bool DEFAULT false, created_by → users SET NULL, created_at)`; индекс `(person_id, effective_date DESC)`.
- `hr_equipment(id bigserial, person_id → team_people CASCADE, kind text CHECK IN ('laptop','phone','monitor','access_card','peripheral','other'), name text NOT NULL (1–120), serial text NULL, issued_at date NOT NULL, return_due date NULL, returned_at date NULL, comment text NULL, created_by → users SET NULL, created_at)`.
- `hr_checklist_templates(id bigserial, kind text CHECK IN ('onboarding','offboarding'), title text NOT NULL (1–120), active bool DEFAULT true, created_at)`; `hr_checklist_template_items(id bigserial, template_id → hr_checklist_templates CASCADE, title text NOT NULL (1–200), sort int NOT NULL DEFAULT 0, days_offset smallint NULL)` (`days_offset` — срок в днях от старта). Сид: по одному шаблону каждого вида («Онбординг: новый сотрудник», «Оффбординг: увольнение») с 5–7 типовыми пунктами (аккаунты и почта, доступ в хаб, оборудование, ознакомление с документами, наставник; отключить доступы, вернуть оборудование, расчёт, передать дела, отметить уволенным в хабе, экспортировать документы).
- `hr_checklists(id bigserial, person_id → team_people CASCADE, kind text CHECK IN ('onboarding','offboarding'), title text NOT NULL, template_id → hr_checklist_templates SET NULL NULL, status text CHECK IN ('active','done','cancelled') DEFAULT 'active', started_at date NOT NULL, created_by → users SET NULL, created_at, closed_at)`; `hr_checklist_items(id bigserial, checklist_id → hr_checklists CASCADE, title text NOT NULL (1–200), sort int, assignee_user_id → users SET NULL NULL, due_date date NULL, done bool DEFAULT false, done_at timestamptz NULL, done_by → users SET NULL NULL, note text NULL (≤500))`.
- `hr_leave_plans(id bigserial, person_id → team_people CASCADE, start_date date NOT NULL, end_date date NOT NULL, comment text NULL (≤300), status text CHECK IN ('planned','cancelled','converted') DEFAULT 'planned', request_id → hr_leave_requests SET NULL NULL, created_by → users SET NULL, created_at; CHECK end_date >= start_date)`; индекс `(person_id, start_date)`.
- Журнал (`log_action`, только id и категории, без ПДн и значений): `hr.history_add|delete`, `hr.equipment_add|update|delete`, `hr.checklist_start|item|close|cancel`, `hr.template_update`, `hr.plan_add|cancel|convert`, `hr.export` (вид, диапазон), `hr.reminders_run` (только счётчики).

## API (prefix `/modules/hr`, ошибки — русский `detail`)
Права: `Me` — любой активный; `Team` — `team` ≥ view и не structure; `Hr` — `run` на `hr`; `Resp` — `responsible` на `hr`; `Mgr` — руководитель этого сотрудника (пользователь, `user_id` карточки-руководителя).

**Дни рождения (`Team`)**
- `GET /birthdays?month=YYYY-MM` (по умолчанию текущий) → `[{personId,name,directionId,day,month}]` (без года/возраста; без `birthdayHidden`, архивных, `show_in_map=false`).
- `PATCH /people/{personId}/file` принимает ещё `birthdayHidden` (`Hr`), `HrFile.birthdayHidden` в ответах.

**Экспорт (`Hr`)**
- `GET /export/people` → `{fileName, dataBase64}`; листы «Сотрудники» (ФИО, должность, направление, руководитель, статус «Работает/Уволен», страна, дата приёма, заполнено %, почта, Telegram, локация, формат работы) — без денег/документов/паспортов. `GET /export/leave?from=YYYY-MM-DD&to=YYYY-MM-DD` → лист «Отпуска» (approved за период: ФИО, вид, с, по, дней) и лист «Баланс» (накоплено/использовано/запланировано/доступно). Диапазон ≤ 400 дней, иначе 422.

**История (`Hr`; записи `salary` — `Resp`)**
- `GET /people/{personId}/history` → `[{id,kind,effectiveDate,title,oldValue,newValue,comment,auto,createdBy(имя),createdAt}]` (для не-`Resp` записи `salary` скрыты). `POST /people/{personId}/history` `{kind,effectiveDate,title,oldValue?,newValue?,comment?}` (`salary` — только `Resp`, иначе 403). `POST /history/{id}/delete` (`Resp` для любых, `Hr` — только `auto=false` не `salary`).
- Автозапись в `PATCH /modules/team/hr/people/{id}` при смене должности/руководителя/направления/архива, а также при `reassignTo` (каждому переданному подчинённому — запись `manager` с именами старого и нового руководителя) (`kind` = position/manager/direction/status, `auto=true`, `effectiveDate = сегодня`, значения — читаемые названия, не id).

**Оборудование (`Hr`)**
- `GET /people/{personId}/equipment` → `[{id,kind,name,serial,issuedAt,returnDue,returnedAt,comment}]`; `POST` `{kind,name,serial?,issuedAt,returnDue?,comment?}`; `PATCH /equipment/{id}` (любые поля, в т.ч. `returnedAt`); `POST /equipment/{id}/delete`. Ограничение 100 записей на человека (409).

**Чек-листы (`Hr`; исполнитель пункта может отмечать свой)**
- `GET /checklist-templates` → `[{id,kind,title,active,items:[{id,title,sort,daysOffset}]}]`; `POST /checklist-templates` `{kind,title,items:[{title,daysOffset?}]}`; `PATCH /checklist-templates/{id}` `{title?,active?,items?}` (items заменяются целиком).
- `GET /people/{personId}/checklists` → `[{id,kind,title,status,startedAt,items:[{id,title,sort,assignee:{id,name}|null,dueDate,done,doneAt,doneBy,note}]}]`; `POST /people/{personId}/checklists` `{templateId, startedAt?}` (пункты копируются из шаблона, `dueDate = startedAt + daysOffset`) → чек-лист; `PATCH /checklist-items/{id}` `{done?,assigneeUserId?|null,dueDate?|null,note?}` — `Hr` любому; назначенному исполнителю (не-HR) разрешены только `done`/`note`; уведомление исполнителю при назначении (link `/modules/hr`); `POST /checklists/{id}/close|cancel` (`Hr`) → чек-лист; когда последний пункт отмечен — статус `done` и уведомление всем HR.
- `GET /checklists?status=active|done|cancelled|all` (`Hr`, по умолчанию `active`) → `[{id,personId,personName,kind,title,status,startedAt,progress:{done,total},overdue}]` (`overdue` — число невыполненных пунктов с `dueDate` < сегодня); сначала с `overdue>0`, затем по `startedAt`.
- `GET /checklists/mine` (`Me`) → пункты, назначенные мне (`[{checklistId,itemId,personName,checklistTitle,title,dueDate,done}]`).

**Годовой график (план отпусков)**
- `GET /me/leave/plans?year=YYYY` (`Me`) → `[{id,start,end,comment,status,requestId}]`; `POST /me/leave/plans` `{start,end,comment?}` (пересечение со своим `planned` → 409; год ≤ текущий+1; прошлое → 422); `POST /me/leave/plans/{id}/cancel`; `POST /me/leave/plans/{id}/request` `{kind?='annual',message}` → создаёт обычную заявку (`LeaveRequest`, поток согласования как есть; даты в прошлом — 422), статус плана `converted`, `requestId`.
- `GET /me/leave/team-plan?year=YYYY` (`Mgr`: руководитель, у которого есть подчинённые-карточки) → `[{personId,name,start,end,comment,status}]` по подчинённым.
- `GET /leave/plan?year=YYYY` (`Hr`) → `[{id,personId,name,directionId,start,end,comment,status}]` все неотменённые планы + `approvedRequests` нет (календарь и так есть).

**Свои документы (`Me`)**
- `GET /me/documents` → `[{id,category,title,fileName,sizeBytes,uploadedAt}]` только своей карточки и `visible_to_employee=true`; `GET /me/documents/{docId}` → `{fileName,mime,sizeBytes,dataBase64}` (чужой/скрытый → 404). Журнал `hr.document_download` как у HR.
- Документы HR (`Resp`): в `POST /people/{personId}/documents` и в списке — поле `visibleToEmployee`; `PATCH /documents/{docId}` `{visibleToEmployee?, title?, category?}` (`Resp`).

**Ядро**
- `/core/me` дополняется ничем; запуск `daily_job` внутри него (см. решение 1). `ModuleManifest.daily_job` у `hr` — `reminders.run_daily`.
- Тексты напоминаний: «Скоро заканчивается испытательный срок: Фамилия Имя (дата)», «Годовщина работы: Фамилия Имя — N лет», «Сегодня день рождения: Фамилия Имя», «Срок возврата оборудования: Фамилия Имя — название (дата)», «Просрочен пункт чек-листа: …».

## Фронтенд
- **HR (person modal, вкладки):** «История» (лента, добавить запись; salary — только responsible), «Оборудование» (таблица, выдать/вернуть/удалить), «Чек-листы» (запустить из шаблона, список пунктов с отметками и назначением, прогресс); в «Деньги и документы» → «Документы» флажок «Показывать сотруднику» (в форме загрузки и переключатель в таблице). Предложение запустить оффбординг при «Отметить уволенным».
- **HR (вкладки модуля):** группа «Команда»: Сотрудники, Анкеты на проверку, Поля анкеты, **Чек-листы** (шаблоны и обзор активных); группа «Отпуска»: Отпуска, **График** (годовой план: таймлайн по месяцам, нагрузка по направлениям, подсветка перегруза ≥ 30% направления), Нормы отпуска. Кнопки «Экспорт в Excel» в «Сотрудники» и «Отпуска».
- **Профиль:** «Мои документы» (только отмеченные HR), «График отпусков» (мой план на год: добавить период, отменить, «Создать заявку»), для руководителей «План команды». Мои пункты чек-листа — в «На согласовании»/отдельный раздел «Задачи» (на твоё усмотрение, только если есть пункты).
- **Карта команды:** в виде «Отпуска» отметки дней рождения (🎂 день+имя во всплывающей подсказке) и блок «Ближайшие дни рождения» сверху (7 дней, без возраста).
- Все строки в `strings.js`; даты ДД.ММ.ГГГГ; мобильность как у остальных страниц.

## Нарезка работ
1. **Backend:** миграция 0007 + SQL + stamp, `ModuleManifest.daily_job` в ядре, пакет hr (history, equipment, checklists, plans, export, reminders, me-документы), тесты в docker, права, журнал без ПДн, README «Выкат 0007».
2. **Mock + фронт А (HR):** история, оборудование, чек-листы (+вкладка «Чек-листы»), экспорт, флаг «Показывать сотруднику».
3. **Mock + фронт Б (профиль/карта/график):** «Мои документы», «График отпусков» (мой, команда, HR-вкладка «График»), дни рождения в карте, ближайшие дни рождения. Весь mock плана — у фронта Б.
4. **Выкат:** `db/07_hr_people_ops.sql` + `deploy/stamp_alembic_0007.sql` под doadmin → merge.

## Открытые вопросы
- Q-P1: порог перегруза графика (30% направления) — настроить после пробного года.
- Q-P2: уведомления вне хаба (Telegram) — отдельная задача.
- Q-P3: праздники в расчёте длительности отпуска (Q-D2) остаётся.

## Отступления backend (2026-10-23)
- `hr_reminder_log.person_id` — `bigint NOT NULL DEFAULT 0` (PK не допускает NULL). Отметка дня запуска — строка `kind = '_run'`, `person_id = 0`. Строки старше 400 дней удаляются при запуске.
- Ключ дедупликации в `hr_reminder_log.person_id`: для `probation_ending`, `work_anniversary`, `birthday` — id человека; для `equipment_return_due` — id записи оборудования (несколько единиц у одного человека не слипаются); для `checklist_overdue` — id чек-листа (одно напоминание в день на чек-лист, в тексте первый просроченный пункт и «и ещё N»).
- `daily_job`: ядро берёт `pg_try_advisory_xact_lock` (ключ `DAILY_JOBS_LOCK` в `routes_core.py`); занято — запуск пропускается. Сбой задачи: откат, в лог пишутся только id модуля и тип исключения.
- Напоминания получают все `run` на hr (включая admin/superuser — у них `run` на всех модулях); день рождения — ещё и руководитель, если у него активная учётка. Годовщина 29 февраля в невисокосный год — 28 февраля; в `GET /birthdays` так же.
- Чек-лист в ответах содержит дополнительное поле `personId`. Проверка прав пункта: HR — любой; исполнитель — только свой и только `done`/`note` (иначе 403; чужой пункт для не-HR — 404). Пункты закрытого/отменённого чек-листа менять нельзя (409): снятие отметки после завершения не поддерживается. `POST /checklists/{id}/close` — статус `done` без уведомления HR (уведомление — только при автозавершении).
- `GET /checklists/mine` отдаёт пункты только активных чек-листов.
- `POST /me/leave/plans/{id}/request` возвращает поля плана (`status = converted`, `requestId`) и вложенное `request` (созданная заявка).
- `GET /me/leave/team-plan`: Mgr — пользователь, привязанный (`team_people.user_id`) к карточке-руководителю с хотя бы одним неархивным подчинённым, иначе 403 (привязка по почте/имени не учитывается); отменённые планы не отдаются. `GET /me/leave/plans?year=` отдаёт планы всех статусов, пересекающие год.
- `PATCH /documents/{id}` пишет в журнал `hr.document_update` (только id и имена полей) — в списке журнала ТЗ его не было.
- `daysOffset` шаблона — целое 0–365; шаблон — от 1 до 50 пунктов; экспорт отпусков включает больничные.
- Экспорт: ячейки-строки, начинающиеся с `=`, записываются как текст (не формула); `@handle` и т.п. не меняются; в «Сотрудники» входят и уволенные (статус «Уволен»), даты — ДД.ММ.ГГГГ текстом. «Заполнено, %» считается как на фронте (`completeness.js`).
- Удаление записи истории `salary` не-`Resp` отвечает 404 (запись для них «не существует»), удаление автозаписи без `responsible` — 403.
- Сид шаблонов идемпотентен через `WHERE NOT EXISTS` по (вид, название): если HR переименовал сидовый шаблон, повторный запуск `07_*.sql` создаст его заново.
- Если `daily_job` упал, откат снимает и отметку `_run`: задача будет повторяться при каждом `/core/me`, пока не перестанет падать (в лог идёт только тип исключения). Уже созданные в этом запуске уведомления тоже откатываются, дублей нет.
- Q-P4 (решён): `GET /me/documents` и `/me/documents/{id}` определяют «свою» карточку только по `team_people.user_id` (без поиска по почте и имени, в отличие от остальных `/me/*`): документы чувствительны. Аккаунт привязывает HR в карточке сотрудника либо сотрудник отправляет анкету.
