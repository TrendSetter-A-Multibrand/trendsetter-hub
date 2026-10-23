# ТЗ: «Карта команды» (модуль team) + управление в модуле HR

Статус: решения согласованы с пользователем 2026-10-23, ветка `dev-karen`. Контракт API ниже заморожен: backend, mock и фронт делаются по нему. Любое отступление — открытый вопрос, не «молчаливое решение».

## Цель
Карта команды (дизайн — `design/Карта команды, новый дизайн/design_handoff_team_map/`: README, prototype, team.json) наполняется настоящими данными. Сотрудник сам заполняет анкету, HR проверяет и одобряет, в карте виден только одобренный вариант. HR управляет людьми, схемой и самими полями анкеты. Модуль HR — будущий «большой инструмент про команду» (отпуска, зарплаты и др.): сейчас в нём вкладки «Анкеты на проверку», «Сотрудники», «Поля анкеты»; раскладка вкладок должна позволять добавлять новые.

## Решения (не пересматривать)
1. **Кто HR.** Новой роли нет. HR = право `run` на модуль `hr` (сотрудник отдела «Персонал», admin/superuser или группа с `run`). Проверка: `module_rights(session, user, ['hr'])['hr'][0] == 'run'` (через `app.core.deps`, пакет hr не импортировать).
2. **Просмотр карты** — модуль `team` (`for_all`, доступ `view`). Уровень `structure` (viewer) получает только `id, name, title, managerId, directionId, isCeo, isAssistant` (7 полей) — без контактов, анкеты, фото.
3. **Модерация.** Любая правка анкеты сотрудником (первая и последующие) — заявка `pending`. В карте остаётся одобренная версия. HR одобряет или отклоняет (отклонение — с обязательной причиной, её видит сотрудник). У пользователя не более одной `pending` заявки. HR правит карточки напрямую, без модерации.
4. **Руководитель, направление, тег, команда, «показывать в карте»** меняет только HR. Поле анкеты «Твой руководитель (ФИ)» — подсказка для HR (`manager_claim`), в карту не попадает.
5. **Гость.** У карточки флаг `show_in_map`. Пользователь хаба без карточки или с `show_in_map=false` в карте не виден; HR кнопкой «Добавить в карту» создаёт карточку из пользователя или включает флаг.
6. **Удаление мягкое:** `is_archived`. Нельзя архивировать человека с активными подчинёнными, не переназначив их (`reassign_to`). Цикл в иерархии запрещён (422). CEO — единственный с `manager_id IS NULL` среди `is_ceo`; CEO нельзя архивировать.
7. **Конструктор анкеты.** Поля хранятся в `team_form_fields`, ответы — JSONB по ключу поля. HR может: добавлять поля, менять подпись/подсказку/обязательность/порядок/варианты, скрывать (`active=false`). Системные поля (`is_system`) нельзя скрыть и менять их `key`/`kind`, остальное можно. Ключ неизменяем.
8. **Фото обязательно** для отправки анкеты. Хранение — в БД (`bytea`, отдельная таблица), без S3/файлов. Браузер сам уменьшает фото (canvas): полное ≤ 512px (JPEG, лимит 300 КБ) и превью 128px (JPEG, лимит 30 КБ). Сервер проверяет магические байты JPEG (`FF D8 FF`) и лимиты, Pillow не добавляем. В JSON передаётся base64 (транспорт умеет только JSON). `<img src>` Bearer-токен отправить не может, поэтому фото всегда приходит как `data:`-URL: превью — внутри `/map`, полное — отдельным запросом.
9. **Уведомление HR.** Общий механизм: `ModuleManifest.badge: Callable[[Session, User], int] | None`; `/core/me` получает `module_badges: {module_id: int}` (только ненулевые). Для `hr` — число `pending`-заявок, только если у пользователя `run` на `hr`. Фронт показывает бейдж у пункта меню и карточки хаба из `me.module_badges` (ядро не знает про модули).
10. **ПДн не в git.** Миграция создаёт только таблицы и справочник направлений (цвета — бренд). Людей загружает разовая команда по образцу `warehouse/legacy_import.py` из файла `team.json` (путь аргументом; по умолчанию сухой прогон, `--apply` пишет, `--rollback`). Файл team.json в репозиторий не коммитить (папка `design/` остаётся untracked).
11. **Демо (Vercel).** Каждый эндпоинт имеет mock-обработчик; mock-данные — вымышленные люди, не реальные.
12. **API-клиент** умеет GET/POST/PATCH. Удаления через HTTP DELETE нет: архивация — `PATCH`/`POST`. CORS не менять.

## Данные (db/04_team.sql, Alembic 0004, deploy/stamp_alembic_0004.sql)
Схема `trendsetter_hub`, повторный запуск безопасен (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`). Таблицы:

- `team_directions(id text PK, label text, short_name text, color text, avatar_ink text, sort int)` + сид 10 направлений и `leadership` (цвета и подписи — из `team.json` → `directions`; `leadership` — для CEO/ассистента, цвет `#A22325`).
- `team_people(id bigserial PK, user_id bigint UNIQUE NULL → users ON DELETE SET NULL, email text NULL, first_name, last_name, title text NOT NULL, manager_id bigint NULL → team_people, direction_id text → team_directions, tag text NULL, team text NULL, is_ceo bool, is_assistant bool, show_in_map bool DEFAULT true, is_archived bool DEFAULT false, answers jsonb DEFAULT '{}', sort int, created_at, updated_at)`; уникальный индекс `lower(email)` где не NULL; индекс по `manager_id`.
- `team_photos(person_id PK → team_people ON DELETE CASCADE, photo_full bytea, photo_thumb bytea, updated_at)` (колонки `photo_*`: FULL — зарезервированное слово PostgreSQL).
- `team_form_fields(id bigserial PK, key text UNIQUE CHECK ^[a-z][a-z0-9_]{1,40}$, label text, hint text NULL, kind text CHECK IN ('text','textarea','select','chips','links','photo'), required bool, options jsonb DEFAULT '[]', sort int, is_system bool, active bool DEFAULT true)`. Сид (порядок как в анкете Google):
  `first_name` (text, req, system) · `last_name` (text, req, system) · `title` (text, req, system) · `manager_claim` («Твой руководитель (ФИ)», text, req, system; только в форме новой карточки без руководителя) · `responsibility` («Зона ответственности», textarea, req, system) · `ask_me_about` («С чем можно обращаться», textarea, req, system) · `location` (select: Москва, Ереван; допускает свой вариант; req, system) · `work_format` (select: «Пятидневка в офисе», «Гибрид», «Удалёнка»; свой вариант; req, system) · `telegram` (text, req, system; хранится без `@`) · `email` (text, optional, system; корпоративная почта; по умолчанию почта учётки) · `hobbies` («Увлечения и таланты», chips, req, system) · `socials` («Соцсети», links, optional, НЕ system) · `photo` (photo, req, system).
  Значения `first_name`, `last_name`, `title`, `email` пишутся в колонки person; остальные — в `answers`. `links` = список `{label, url}` (url только http/https, до 5 штук). `chips` = список строк (до 20, каждая до 60). `select` с `allow_custom`: вариант вне `options` допустим для `location` и `work_format` (`options` поля хранит и `{"allow_custom": true}` не нужен — свой вариант разрешён для всех `select`).
- `team_submissions(id bigserial PK, user_id → users, person_id NULL → team_people, status text CHECK IN ('pending','approved','rejected'), values jsonb, photo_full bytea NULL, photo_thumb bytea NULL, review_comment text NULL, reviewed_by NULL → users, created_at, reviewed_at)`; частичный уникальный индекс `(user_id) WHERE status='pending'`; список не читает `photo_full` (`hasPhoto` = `photo_full IS NOT NULL`), `photo_thumb` читает ради поля `thumb`.
- Все таблицы с приставкой `team_`. Таблицы `hub_app` доступны автоматически (как у warehouse; проверить по `db/modules/_template.sql`).
- Журнал: `log_action` (`team.submit`, `team.approve`, `team.reject`, `team.person_create|update|archive`, `team.field_create|update`), `module_id='team'`.

## API (prefix `/modules/team`, ошибки — русский `detail`)
Права: `Team` = `team` access ≥ view (иначе 403); `structure` — урезанный `/map`, остальное 403; `Hr` = `run` на `hr`.

Объекты:
```
Direction  {id,label,shortName,color,avatarInk}
PersonPub  {id,name,title,managerId,directionId,tag,isCeo,isAssistant,
            team,location,workFormat,responsibility,askMeAbout,hobbies[],telegram,email,socials[],thumb,
            extra[{key,label,kind,value}]}   // name="Фамилия Имя"; thumb = data-URL|null; extra = ответы на активные НЕсистемные поля по sort (кроме `socials`, он в `socials[]`), пустые пропускаются; у structure — только id,name,title,managerId,directionId,isCeo,isAssistant (без extra)
PersonOwn  = PersonPub + {firstName,lastName,showInMap,isArchived,hasPhoto}   // поле `person` в GET /me
Field      {id,key,label,hint,kind,required,options[],sort,isSystem,active}
```
- `GET /map` → `{directions: Direction[], people: PersonPub[]}` — только `show_in_map AND NOT is_archived`, порядок `sort, id`. Направления с людьми и `leadership`.
- `GET /fields` → `Field[]` (только `active`, по `sort`).
- `GET /people/{id}/photo` → `{data: "data:image/jpeg;base64,…"}` | 404. Team ≥ view (не structure).
- `GET /me` → `{person: PersonOwn|null, values: {key: value}, submission: null | {id,status,reviewComment,createdAt}, photo: dataURL|null}` — `values` предзаполнены из карточки (или из `pending`-заявки, если она есть); `person` по `user_id`, если нет — по `lower(email)=lower(user.email)` (связь запоминается при первом `POST /me/submission` или одобрении). `submission` — последняя заявка пользователя. Если `pending` нет, а последняя заявка `rejected`, `values` и `photo` предзаполняются из неё (поверх карточки), и `POST /me/submission` с `photo: null` копирует фото из этой отклонённой заявки.
- `POST /me/submission` `{values: {key: value}, photo: {full: dataURL, thumb: dataURL} | null}` → `{id,status:"pending"}`. Валидация по активным полям: обязательные заполнены, тип/лимиты, `select` — строка ≤ 80, фото обязательно, если у карточки ещё нет фото. 409 если уже есть `pending` (предварительно можно заменить: `PATCH /me/submission` с теми же данными обновляет свою `pending`). 403 для `structure`.
- `POST /me/submission/cancel` → `{ok:true}` отзывает свою `pending`.

HR (все — `Hr`, иначе 403; в mock то же):
- `GET /hr/pending-count` → `{count}`.
- `GET /hr/submissions?status=pending|approved|rejected|all` → `[{id,userId,userName,userEmail,personId|null,status,createdAt,reviewedAt,reviewComment,values,hasPhoto,thumb,current: {…текущие значения карточки}|null}]`.
- `GET /hr/submissions/{id}/photo` → `{data}` полное фото заявки.
- `POST /hr/submissions/{id}/approve` `{personId?: int, managerId?: int|null, directionId?: str, tag?, team?, showInMap?: bool}` → `PersonHr`. Если у заявки нет карточки: создаётся новая (`directionId` и `managerId` обязательны) либо присоединяется к существующей `personId` (карточки из сида без `user_id`). Значения копируются в карточку, фото заменяется, `user_id` привязывается. 409 если заявка не `pending`.
- `POST /hr/submissions/{id}/reject` `{comment}` (1–500 символов).
- `GET /hr/people` → `PersonHr[]` все, включая скрытые/архивные: `PersonPub + {firstName,lastName,userId,userEmail,showInMap,isArchived,hasPhoto,directReports,answers}`.
- `GET /hr/directions` → `Direction[]` все направления из `team_directions` по `sort`, включая пустые и `leadership`.
- `GET /hr/users` → пользователи хаба `{id,fullName,email,personId|null}` (для привязки и «Добавить в карту»).
- `POST /hr/people` `{firstName,lastName,title,directionId,managerId|null,email?,userId?,tag?,team?,showInMap?,values?,photo?}` → `PersonHr` (HR заполняет анкету за человека; обязательность полей анкеты НЕ проверяется, кроме имени/фамилии/должности/направления; `managerId` обязателен, кроме CEO).
- `PATCH /hr/people/{id}` — любые из полей выше + `isArchived`, `sort`; смена `managerId` проверяет цикл; `isArchived=true` с активными подчинёнными без `reassignTo` → 409 «Сначала переназначьте подчинённых»; с `reassignTo` подчинённые переносятся. Нельзя править/архивировать CEO сменой `managerId`/`isArchived`.
- `GET /hr/people/{id}/photo`, фото меняется через `PATCH` полем `photo`.
- `GET /hr/fields` → все `Field[]` включая скрытые.
- `POST /hr/fields` `{key,label,hint?,kind,required,options?}` → `Field` (в конец порядка; 409 при повторе ключа). `kind='photo'` — только системное.
- `PATCH /hr/fields/{id}` `{label?,hint?,required?,options?,sort?,active?}`; `PATCH /hr/fields/reorder` `{ids:[…]}`. Для `is_system`: `active=false` → 422; `kind`/`key` не меняются никогда. Скрытие поля не удаляет ответы.
- Ответ `GET /core/me` дополняется `module_badges` (см. решение 9).

## Нарезка работ (каждая фаза проверяется до следующей)
1. **Backend:** миграция + SQL + stamp + сид-команда (`backend/app/modules/team/seed.py`: `python -m app.modules.team.seed <team.json> [--apply] [--rollback]`; сухой прогон по умолчанию) + `service.py`/`router.py` по контракту + `ModuleManifest.badge` + `module_badges` + pytest (права HR/viewer/employee, модерация, цикл, архив с подчинёнными, конструктор, лимиты фото). Тесты требуют `HUB_TEST_ADMIN_DSN` (docker compose); если не запустить — так и писать.
2. **Mock-слой:** `frontend/src/core/api/mock/` — обработчики всех эндпоинтов, вымышленные данные (≈15 человек).
3. **Фронт «Направления»**, профиль-панель, поиск/фильтры/сворачивание, цепочка до CEO (по README дизайна, все строки — `modules/team/strings.js`).
4. **Фронт «Схема»:** порт `layoutScheme()` из `prototype/team-map.dc.html` один в один; зум, панорамирование.
5. **Анкета:** форма в профиле сотрудника (точка входа — кнопка «Моя анкета» в карте и в панели своего профиля), строится по `GET /fields`, ресайз фото, статусы заявки.
6. **HR:** страница модуля `hr` с вкладками (заявки с бейджем, сотрудники с CRUD/мягким удалением/«показывать в карте»/добавить из пользователя, конструктор полей). Затем `team` и `hr` переключаются в обоих реестрах с `roadmap` на `mvp`.

## Критерии приёмки (вне тестов)
- Добавили человека в HR → он появился в обоих видах, линии и стрелки протянулись без перезагрузки; удалили (архив) → линии перестроились.
- Сотрудник отправил анкету → в карте старая версия, у HR бейдж +1 в меню и в хабе, у остальных бейджа нет; одобрили → карта обновилась; отклонили → сотрудник видит причину.
- Добавили поле «Соцсети»/новое обязательное поле → форма и профиль подхватывают его без деплоя.
- viewer не видит контактов и фото ни в UI, ни в ответе API.

## Открытые вопросы
- Q-T1: логотип SVG из Figma (файл сайта) — отдельным шагом после фаз 1–3; до этого текстовый «TRENDSETTER».
- Q-T2: где хранить ПДн-сид `team.json` на сервере (вне репозитория, как xlsx склада).
- Q-T4 (решено): CEO через API не создаётся (нет `isCeo` в контракте), `managerId` при создании обязателен всегда; CEO появляется только из сида.
- Q-T3: нужен ли отдельный тег «ассистент» в БД (сейчас `is_assistant`).
