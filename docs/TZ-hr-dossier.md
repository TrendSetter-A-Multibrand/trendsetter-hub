# ТЗ: профиль сотрудника, HR-досье, отпуска, уведомления

Статус: решения согласованы с пользователем 2026-10-23, ветка `dev-karen`. Контракт API заморожен: backend, mock и фронт делаются по нему. Любое отступление — открытый вопрос (`TODO(Qn)`), не молчаливое решение. Продолжает `docs/TZ-team-map.md` (карточки `team_people`, анкета, HR-вкладки уже есть).

## Решения (не пересматривать)
1. **Доступ к деньгам и документам** — отдельный уровень: право `responsible` на модуль `hr`. Оно выдаётся **вручную на конкретного сотрудника** (без групп): в админке на пользователя можно поставить «особые права на модуль» (`view` / `run` / `responsible`). Групповые права остаются и складываются с личными (итог — максимум). Обычный HR (`run`) видит базовое досье и отпуска, но **не видит** блок «Деньги и документы». admin/superuser ответственными автоматически не считаются (Q-G2): право ставится явно.
2. **Страны:** РФ (`RU`) и Армения (`AM`). Нормы отпуска — справочник `hr_leave_policies` по стране, правится руками в HR (право `responsible`). Начальные значения: 28 календарных дней в год, накопление 2,333 дня в месяц; для РФ право на первый отпуск через 6 месяцев (`first_leave_after_months=6`), для Армении 0. **TODO(Q-D1): нормы Армении и порядок подсчёта сверить с юристом/бухгалтером.** Единица — календарные дни; праздничные дни внутри отпуска пока считаются как обычные (**TODO(Q-D2)**).
3. **Календарь отпусков** виден всем, кто видит «Карту команды» (`team` ≥ view): только «кто отсутствует и когда» (без сообщений, типа причины и остатков). Живёт в Карте команды третьим видом «Отпуска» (рядом с «Направления» и «Схема»), плюс на карточках метка «в отпуске сейчас».
4. **Деньги сразу, но пустые:** блок «Деньги и документы» создаём полностью (оклад, валюта, даты выплат, ИНН/СНИЛС/паспорт и т. д.), значения пустые; поля можно скрыть/удалить позже. Шифрование на уровне приложения не делаем сейчас (**TODO(Q-D3)**: ключ в env и Fernet, если решит безопасность).
5. **Профиль сотрудника:** клик по аватарке/имени внизу слева в боковом меню открывает страницу `/profile` с разделами: «Моя анкета» (та же форма, что в карте), «Отпуск» (баланс, заявки, новая заявка), «Мои данные» (только чтение: основное досье без денег; деньги видит только сам человек? — **нет, не показываем** до отдельного решения), «Настройки» (смена пароля — если есть в ядре; иначе раздел скрыт). Страница доступна всем активным сотрудникам, сотрудник без карточки видит только «Настройки» и предложение заполнить анкету.
6. **Заявка на отпуск:** сотрудник выбирает даты, вид, пишет сообщение для коллег («как со мной связаться / к кому обращаться») → заявка уходит руководителю (`manager_id` карточки → пользователь по `user_id`) на согласование; HR получает уведомление. Если у руководителя нет аккаунта — согласует HR (`run`). После согласования коллеги получают уведомление «X не будет с … по …» с этим сообщением; баланс уменьшается. Отклонение — с комментарием, сотрудник уведомляется. Сотрудник может отозвать свою заявку (`pending` или будущую `approved`) — тогда коллегам уходит уведомление об отмене.
   **Коллеги** = все неархивные люди с тем же руководителем (`manager_id`), сам руководитель, и все HR (`run` на `hr`). Расширять позже.
7. **Уведомления** — внутри хаба (колокольчик + счётчик + список, помечаются прочитанными). Почты и мессенджера нет; интеграция с Telegram — позже (**TODO(Q-D4)**).
8. **Видеосвязь** — поле анкеты `video_link` («Видеосвязь: Zoom / Яндекс Телемост»), тип `links`, необязательное, не системное; добавляется в SQL-миграции.

## Данные (db/05_hr_dossier.sql, Alembic 0005, deploy/stamp_alembic_0005.sql)
Схема `trendsetter_hub`, скрипт повторно запускаем (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`). Ядро — без приставки, HR — с `hr_`.
- `user_module_permissions(user_id → users ON DELETE CASCADE, module_id text, permission text CHECK IN ('view','run','responsible'), PK(user_id, module_id))` — одно право на пару; итог с групповыми — максимум (как сейчас).
- `notifications(id bigserial, user_id → users CASCADE, kind text, title text, body text, link text NULL, created_at timestamptz, read_at timestamptz NULL)`; индекс `(user_id, read_at, created_at DESC)`.
- `hr_leave_policies(country text PK CHECK IN ('RU','AM'), days_per_year numeric(5,2), accrual_per_month numeric(5,3), first_leave_after_months smallint, updated_at)` + сид RU и AM.
- `hr_employee_files(person_id PK → team_people CASCADE, legal_name text, birth_date date, country text NULL CHECK IN ('RU','AM'), employment_type text NULL CHECK IN ('staff','gph','ip','other'), hired_at date, probation_until date, contract_no text, contract_date date, work_schedule text, dismissed_at date, dismissal_reason text, phone text, personal_email text, emergency_contact text, notes text, updated_at timestamptz, updated_by → users SET NULL)` — базовое досье (HR `run`).
- `hr_employee_sensitive(person_id PK → team_people CASCADE, salary numeric(12,2), currency text, pay_day_1 smallint, pay_day_2 smallint, bonus_note text, tax_id text, social_id text, passport text, bank_details text, updated_at, updated_by)` — только `responsible`.
- `hr_leave_adjustments(id bigserial, person_id → team_people CASCADE, delta_days numeric(6,2), reason text, created_by → users SET NULL, created_at)` — начальный остаток/корректировки (может быть отрицательной).
- `hr_leave_requests(id bigserial, person_id → team_people CASCADE, kind text CHECK IN ('annual','unpaid','study','sick','other'), start_date date, end_date date, days numeric(6,2), message text, status text CHECK IN ('pending','approved','rejected','cancelled'), approver_user_id → users SET NULL NULL, decided_by → users SET NULL, decided_at, decision_comment text, created_by → users SET NULL, created_at; CHECK end_date >= start_date)`; индекс `(person_id, start_date)`; HR может создать заявку за сотрудника сразу `approved`.
- В `team_form_fields` — строка `video_link` (links, optional, не system, sort после `socials`); при отсутствии — вставка.
- Журнал: `log_action` (`hr.file_update`, `hr.sensitive_update` — только id и имена полей, **значения не пишем**, `hr.leave_request|approve|reject|cancel|adjust`, `hr.policy_update`, `core.user_permission_set`).

## Расчёт баланса (чистая функция + тесты)
Для карточки с `hired_at` и страной (`country`, иначе RU):
- `months` = полные месяцы от `hired_at` до сегодня; `accrued = round(months × accrual_per_month, 2)`; если `months < first_leave_after_months` — `available_from` = дата, когда наступает право (баланс показывается, но подаём заявку можно только на даты не раньше неё; 422 «Право на отпуск возникает с …»).
- `adjust` = сумма `hr_leave_adjustments`.
- `used` = сумма `days` approved `annual`-заявок с `end_date < today`; `planned` = approved `annual` с `end_date >= today`.
- `available = accrued + adjust − used − planned`. Нет `hired_at` → баланс `null`, подсказка «HR не указал дату приёма».
- Дни заявки: календарные, включительно (`end − start + 1`); для видов, кроме `annual`, баланс не уменьшается.
- Пересечение с уже `pending/approved` заявками того же человека → 409. Заявка в прошлом — 422 (HR создаёт задним числом через HR-эндпоинт).

## API
Права: `Me` = любой активный сотрудник; `Team` = `team` ≥ view; `Hr` = `run` на `hr`; `Resp` = `responsible` на `hr`. Ошибки — русский `detail`. Новые маршруты модуля hr — пакет `backend/app/modules/hr/`, `prefix=/modules/hr`, регистрируется в `core/registry.py` (у `hr` уже есть badge — оставить, **добавить** в badge заявки на отпуск `pending`, ожидающие HR, т.е. без руководителя-пользователя).

**Ядро**
- `GET /core/notifications?unread=1&limit=30` → `[{id,kind,title,body,link,createdAt,read}]`; `POST /core/notifications/read` `{ids:[…]|null}` (null = все) → `{ok:true}`. `/core/me` дополняется `unread_notifications: int`.
- `GET /admin/users/{id}/module-permissions` → `{permissions:{moduleId: 'view'|'run'|'responsible'}}`; `PATCH …` `{moduleId, permission|null}` (admin). Валидация модуля и права как у групп. `module_rights` учитывает личные права (максимум с групповыми). `/core/me.module_responsible` отражает итог.

**Профиль / отпуск сотрудника (`Me`)**
- `GET /modules/hr/me/leave` → `{person:{id,name}|null, policy:{country,daysPerYear,accruePerMonth,firstLeaveAfterMonths}|null, balance:{accrued,adjust,used,planned,available,availableFrom}|null, requests:[LeaveRequest], approver:{name}|null}`; нет карточки → `person:null`.
- `POST /modules/hr/me/leave/requests` `{kind,start,end,message}` → `LeaveRequest` (статус `pending`; уведомление approver или всем HR).
- `POST /modules/hr/me/leave/requests/{id}/cancel` → `LeaveRequest` (свою `pending`, либо `approved` с `start_date >= today`; для approved — уведомить коллег).
- `GET /modules/hr/me/approvals` → заявки, где я approver (`pending`) и недавние решённые мной; `POST /modules/hr/leave/requests/{id}/decision` `{approve: bool, comment?}` — approver этой заявки или `Hr`; `approve` → `approved`, уведомления коллегам (`kind='leave_approved'`, тело: «Фамилия Имя не будет на работе с … по …. Сообщение: …»), сотруднику; `reject` → comment обязателен (1–500), уведомление сотруднику. 409 если заявка не `pending`.
- `GET /modules/hr/me/file` (`Me`) → `{person:{id,name}|null, file:{legalName,hiredAt,country,workSchedule}|null}`: только эти четыре поля своего базового досье (без денег и остального); нет карточки или досье — `file: null`.
- Ссылки уведомлений: заявка руководителю — `/profile?section=approvals`; решение/отклонение сотруднику — `/profile?section=leave`; заявка, ждущая HR, — `/modules/hr`; коллегам (согласовано/отмена) — `/modules/team`.
- `LeaveRequest = {id,personId,personName,kind,start,end,days,message,status,decidedBy,decidedAt,decisionComment,createdAt,awaitingHr}`; `awaitingHr` = `pending` без руководителя с активным аккаунтом (ждёт HR; решение может принять и любой HR).

**Календарь (`Team`, не structure)**
- `GET /modules/hr/leave/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD` → `[{personId,name,directionId,kind,start,end}]` только `approved` (все виды, кроме `sick` — больничные в общий календарь не попадают); диапазон ≤ 400 дней, иначе 422. Без message и баланса.

**HR (`Hr`)**
- `GET /modules/hr/people/{personId}/file` → `{file: HrFile, leave:{policy,balance,requests,adjustments[]}, canSeeSensitive: bool}`; `PATCH /modules/hr/people/{personId}/file` (частичное обновление `HrFile`; даты `YYYY-MM-DD`; `country`/`employmentType` из списков).
- `GET /modules/hr/people/{personId}/sensitive` (`Resp`, иначе 403) → `HrSensitive`; `PATCH …` (`Resp`).
- `POST /modules/hr/people/{personId}/leave/requests` `{kind,start,end,message?,status?:'approved'}` — HR оформляет за сотрудника (в т.ч. задним числом), без уведомления approver; коллегам уведомление, если `start >= today`. `POST …/leave/adjustments` `{deltaDays, reason}`.
- `POST /modules/hr/leave/requests/{id}/cancel` (`Hr`) → `LeaveRequest`: HR снимает любую `pending`/`approved` заявку (в т.ч. прошедшую); `cancelled`, баланс пересчитывается; коллегам уведомление, если `start >= today` и вид не `sick`; сотруднику «HR отменил заявку»; 409 если уже `cancelled`/`rejected`.
- `GET /modules/hr/leave/requests?status=pending|approved|rejected|cancelled|all&personId=` — все заявки (для HR-вкладки «Отпуска»).
- `GET /modules/hr/leave/policies` / `PATCH /modules/hr/leave/policies/{country}` (`Resp`).
- Синхронизация: при `dismissed_at`/архивации карточки (`PATCH /hr/people`) дата увольнения предлагается, но не проставляется автоматически.
- `HrFile`/`HrSensitive` — camelCase версии колонок выше; пустое = `null`. Значения `HrSensitive` никогда не попадают в журнал, `/map`, `/hr/people` и экспорты.

**Документы сотрудника (`Resp`, миграция 0006)**
- Живут в блоке «Деньги и документы»: ВСЕ операции требуют `responsible` на `hr` (HR с `run` и admin получают 403). Сотрудник свои документы пока не видит. Файлы хранятся в БД (`hr_documents` — метаданные, `hr_document_files.content bytea` — содержимое; список содержимое не читает), S3 нет.
- `GET /modules/hr/people/{personId}/documents` → `[{id,category,title,fileName,mime,sizeBytes,uploadedBy,uploadedAt}]` (`uploadedBy` — имя пользователя или `null`; новые сверху). Нет человека — 404.
- `POST /modules/hr/people/{personId}/documents` `{category,title,fileName,dataBase64}` (JSON, base64 без переносов строк и префикса `data:`) → документ (та же форма). `category` ∈ `contract|order|id_doc|tax|bank|medical|other`; `title` 1–120 символов (обрезается по краям). Ошибки: 422 (категория, название, имя/расширение, битый base64, пустой файл, содержимое не соответствует расширению), 413 (файл больше 8 МБ до кодирования), 409 (у человека уже 50 документов), 404 (нет человека).
- Белый список: pdf, jpg/jpeg, png, doc, docx, xls, xlsx, txt. Проверка начала файла: PDF `%PDF`, JPEG `FF D8 FF`, PNG `89 50 4E 47`, docx/xlsx `PK 03 04`, doc/xls `D0 CF 11 E0`; txt — без нулевых байт и валидный UTF-8. `mime` выставляет сервер по расширению (клиентскому не верим). Имя файла очищается: берётся часть после последнего `/` или `\`, удаляются управляющие символы, длина ≤ 120 (расширение сохраняется).
- `GET /modules/hr/documents/{docId}` → `{fileName,mime,sizeBytes,dataBase64}` (скачивание); 404 если нет.
- `POST /modules/hr/documents/{docId}/delete` → `{ok:true}` (строка и файл удаляются; DELETE в CORS нет, поэтому POST); 404 если нет. Удаление человека каскадом удаляет его документы.
- Журнал: `hr.document_upload|download|delete` с `{document_id, person_id, category}`; без названий, имён файлов и содержимого. Документы не попадают в `/hr/people`, `/file`, `/sensitive`, `/map`, `/me/*`.
- Тело запроса может быть до ~11 МБ (8 МБ в base64): проверить лимит `client_max_body_size` в nginx (по умолчанию 1 МБ).
- TODO(Q-D3): шифрование содержимого на уровне приложения не делается.

## Фронтенд
- **Ядро:** колокольчик в шапке/сайдбаре (счётчик из `/core/me.unread_notifications`, список, «прочитать все», переход по `link`); страница `/profile` (клик по пользователю внизу слева в `AppLayout`) с разделами из решения 5; в админке «Пользователи» — кнопка «Особые права» (модуль → право) на пользователя.
- **Профиль → Отпуск:** баланс (накоплено / использовано / запланировано / доступно), заявки со статусами, кнопка «Выбрать отпуск» (диапазон дат antd RangePicker, вид, сообщение коллегам с подсказкой «как связаться / кто замещает»), «Отозвать».
- **Согласование:** руководитель видит в профиле раздел «На согласовании» (счётчик в бейдже профиля/колокольчике), кнопки «Согласовать» / «Отклонить с комментарием».
- **Карта команды:** третий вид «Отпуска» — таймлайн по месяцам (группы по направлениям, фильтр и поиск общие), переключатель месяца; метка «в отпуске» на карточках в обоих видах за сегодня.
- **HR:** в модалке/странице сотрудника вкладки «Досье» (базовое), «Деньги и документы» (только `Resp`, иначе вкладки нет), «Отпуск» (баланс, заявки, корректировка, оформить за сотрудника); вкладка модуля «Отпуска» (все заявки, фильтр, решение за руководителя); вкладка «Нормы отпуска» (политики, `Resp`). Новые вкладки — записями в массиве `TABS`.
- Все строки — в `strings.js` модулей; даты в UI `ДД.ММ.ГГГГ`.

## Нарезка работ (проверять каждую фазу)
1. **Backend:** миграция 0005 + SQL + stamp, ядро (личные права, уведомления), пакет `modules/hr` (досье, отпуска, календарь, политики, заявки/решения/уведомления), расчёт баланса, `badge` hr, тесты (docker).
2. **Mock + фронт ядра и профиля** (параллельно с 3): mock-обработчики ядра, `/profile`, колокольчик, «Особые права», раздел «Отпуск» профиля и согласование.
3. **Mock + фронт HR и Карты:** досье/деньги/отпуск в HR, вкладки «Отпуска» и «Нормы отпуска», вид «Отпуска» в Карте команды, метка «в отпуске».
4. **Выкат:** `db/05_hr_dossier.sql` + `deploy/stamp_alembic_0005.sql` под doadmin → merge. Затем поставить `responsible` на hr нужным людям в админке.

## Открытые вопросы
- Q-D1: нормы отпуска Армении, расчёт «первого отпуска».
- Q-D2: праздники внутри отпуска (в РФ не входят в календарные дни отпуска).
- Q-D3: шифрование ПДн (паспорт, ИНН, реквизиты) на уровне приложения.
- Q-D4: канал уведомлений вне хаба (Telegram-бот / почта).
- Q-D5: видит ли сотрудник свой оклад в профиле (сейчас — нет).
