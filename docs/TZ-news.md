# ТЗ: главная, этап 2 — «Новости компании» (новости, события с RSVP, срочная плашка)

Статус: решения пользователя 2026-10-26 (включая ответы на Q-N1, Q-N2, Q-N5 — см. «Закрытые вопросы»), ветка `home-layout`. ТЗ — lead. Продолжает `docs/TZ-home.md` (этап 1). Контракт заморожен; любое отступление — открытый вопрос `TODO(Q-Nn)`, поднимается пользователю. Блок «Соцсети» и Google Календарь (этап 3) — **не в этом ТЗ**.

**Зависимость:** незакоммиченная правка раскладки главной в `home-layout` (центрирование `.stack.home`, `.hero.compact`, без «Последних запусков», `HOME_WIDGETS` без `area`, плоская сетка `.home-grid`) **коммитится до начала работ**. ТЗ опирается на неё, а не на HEAD `8a573d9`.

## Решения (не пересматривать)
1. **Новости — новый модуль `news`** (for_all, **скрытый** из меню и «Моих инструментов»), а не часть ядра. Почему модуль: (а) таблицы получают приставку `news_` по правилу CLAUDE.md; (б) право редактора получается **без нового механизма прав и без DDL для прав**: «Особые права» (`user_module_permissions`, CHECK `view|run|responsible`) и группы уже работают для любого `module_id` из `MODULES` (бэкенд `_check_permissions` пускает только id из `MODULES`), а `UserPermissionsModal` / `GroupsTab` перечисляют фронтовый `MODULES` сами; (в) блоки главной и вкладка профиля подключаются через `HOME_WIDGETS` / `PROFILE_SECTIONS`, ядро модуль не импортирует.
2. **Скрытие из меню — один новый флаг фронтового реестра `hidden: true`** (самый простой способ в рамках существующей модели): модуль остаётся в `MODULES` (значит, есть в «Особых правах», группах, `me.module_access` / `me.module_responsible`, mock `accessTo`), но:
   - `AppLayout` не показывает модули с `hidden` в левом меню;
   - `HubPage` не показывает их в «Моих инструментах» и не считает в счётчике `[NN]`;
   - `ModulePage` для `hidden`-модуля отдаёт `NotFoundPage` (страницы `/modules/news` нет).
   Модуль `news` ставится **последней строкой** `MODULES`, поэтому номера `nav-idx` остальных пунктов не сдвигаются. Бэкенд меню не знает: манифест `news` в `registry.py` нужен для `/core/me` и проверки прав; `module_access.news` появляется в `/core/me` у всех (это ожидаемо, `test_me.py` обновляется).
3. **Право «Редактор новостей» = `responsible` на модуле `news`** (Профиль → «Пользователи и отделы» → «Особые права», строка «Новости» → «Ответственный»; через группу доступа тоже работает) **ИЛИ администратор** (`can_manage_users`). Явное «ИЛИ админ» нужно из-за Q-G2 (admin/superuser автоматически не ответственные) — как у HR-журнала. Superuser без права — не редактор (`TODO(Q-N3)`).
   - Бэкенд: `is_editor(session, user) = module_rights(session, user, ["news"])["news"][1] or can_manage_users(...)` — **одна функция** в `modules/news/service.py`.
   - Фронт: `isNewsEditor(me) = me.module_responsible?.news === true || me.can_manage_users === true` — одна функция в `modules/news/lib/news.js`.
   - Опции `view` / `run` у строки «Новости» в «Особых правах» ничего не меняют (все сотрудники и так видят) — не чинить, `TODO(Q-N4)`.
4. **Читатель** (лента на главной, плашка, RSVP) = `can_see_data(access news)`, т. е. `view` или `run`: все активные сотрудники, **кроме viewer** (у viewer на for_all-модуле `structure`). viewer получает **403** на `feed`, `banner`, `rsvp`, `responses` (как `team_viewer` в модуле team); на главной блок «Новости» и плашка для него **не рендерятся и запросов не делают**. Гейт — одна функция `can_read(access)` (бэкенд) / `canReadNews(me)` (фронт). Известное следствие Q-G1: viewer, добавленный в группу с `view`/`run` на `news`, станет читателем — не чинить.
5. **Имена ответивших — настройка события** `rsvpNamesPublic` (столбец `rsvp_names_public`, по умолчанию `false`): `false` — список имён видит только редактор; `true` — все читатели видят имена по группам «Иду / Думаю / Не иду». Счётчики видят все читатели всегда. Редактор переключает при создании и правке события. RSVP в журнал **не пишется** (личный ответ, большой объём).
6. **Админка — вкладка «Новости» в профиле** (`/profile?section=news`, рядом с «Моя анкета», «Отпуск» и т. д.) через `PROFILE_SECTIONS`, видна **только** при `isNewsEditor(me)`. Там: списки «Актуальное» / «Прошедшие и архив» / «Черновики», создание и правка, публикация, архив, удаление, ответы RSVP, панель «Срочная плашка». **Обычным сотрудникам лента — только блок на главной** (ближайшие события и последние новости, детали в модалке, RSVP); архива прошедших и отдельной страницы у них нет. Эндпоинт списков `GET /items` — только редактору.
7. **Контент — только plain text.** Описание/программа выводится с `white-space: pre-wrap`; HTML/markdown не поддерживаются, `dangerouslySetInnerHTML` запрещён, ссылки в тексте не кликабельны (`TODO(Q-N8)`).
8. **Время.** Хранение — `timestamptz`. Редактор вводит дату/время в зоне своего браузера (`<Input type="datetime-local">`), показ — в зоне браузера читателя (`formatDateTime` из `core/format.js`). Время внутри свободного текста программы не пересчитывается. Офисы РФ/АМ различаются на 1 ч — `TODO(Q-N6)`.
9. **«Прошедшее» событие** = `coalesce(ends_at, starts_at) < now`. Прошедшее скрывается с главной, **даже если закреплено**; в админке оно в «Прошедшие и архив». Событие без окончания исчезает в момент начала (`TODO(Q-N7)`; в форме — подсказка указывать окончание).
10. **Срочная плашка** — статичная красная полоса **над hero** главной (не бегущая строка), кнопка «Скрыть» запоминает `id` в `localStorage`. Правило id: **новый текст → новая строка с новым id** (все, кто скрыл старую, увидят новую); смена только даты окончания → id **не меняется**; выключение id не меняет, но повторное включение после «Выключить» (даже с тем же текстом) создаёт **новую** строку и новый id — плашку снова увидят все (осознанно: это повторное объявление). Активна не больше одной (частичный уникальный индекс). Отдельный эндпоинт; ошибка запроса или `localStorage` → плашка молча не показывается, главная не ломается.
11. **Журнал** (`audit_log`, `module_id='news'`): создание, правка, публикация/снятие, архив/возврат, удаление записей и все действия с плашкой. В `details` — только `news_id` / `banner_id`, `kind`, `status`, `fields` (имена изменённых полей). **Никаких заголовков и текстов.** Читалки журнала новостей в этом этапе нет; HR-журнал (`/modules/hr/audit`) действия `news.*` **не показывает** и не меняется (`TODO(Q-N12)`).

## Данные (`db/09_news.sql`, Alembic `0009`, `deploy/stamp_alembic_0009.sql`)
Идемпотентно (`CREATE TABLE IF NOT EXISTS`, `CREATE [UNIQUE] INDEX IF NOT EXISTS`), схема `trendsetter_hub`, шапка-комментарий в стиле `08_security.sql` («ШАГ 9…», выполнять под doadmin в `defaultdb` после `08_security.sql`; права hub_app — через `ALTER DEFAULT PRIVILEGES` из `01_core_hub.sql`, он покрывает и таблицы, и последовательности). Существующие `.sql` не трогать. Права на модуль — **без DDL**; привязки к отделам (`module_departments`) не нужно (for_all).

```sql
CREATE TABLE IF NOT EXISTS trendsetter_hub.news_items (
  id                 bigserial PRIMARY KEY,
  kind               text NOT NULL CHECK (kind IN ('news', 'event')),
  title              text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body               text NOT NULL DEFAULT '' CHECK (char_length(body) <= 5000),
  place              text CHECK (place IS NULL OR char_length(place) BETWEEN 1 AND 200),
  starts_at          timestamptz,
  ends_at            timestamptz,
  pinned             boolean NOT NULL DEFAULT false,
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  archived           boolean NOT NULL DEFAULT false,
  rsvp_enabled       boolean NOT NULL DEFAULT false,
  rsvp_deadline      timestamptz,
  rsvp_names_public  boolean NOT NULL DEFAULT false,
  published_at       timestamptz,
  created_by         bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'event' OR (starts_at IS NULL AND ends_at IS NULL AND place IS NULL
                            AND NOT rsvp_enabled AND rsvp_deadline IS NULL AND NOT rsvp_names_public)),
  CHECK (kind = 'news' OR starts_at IS NOT NULL),
  CHECK (ends_at IS NULL OR ends_at >= starts_at),
  CHECK (rsvp_deadline IS NULL OR rsvp_deadline <= starts_at)
);
CREATE INDEX IF NOT EXISTS news_items_feed_idx ON trendsetter_hub.news_items (status, archived, kind, starts_at);

CREATE TABLE IF NOT EXISTS trendsetter_hub.news_rsvp (
  item_id    bigint NOT NULL REFERENCES trendsetter_hub.news_items (id) ON DELETE CASCADE,
  user_id    bigint NOT NULL REFERENCES trendsetter_hub.users (id) ON DELETE CASCADE,
  answer     text NOT NULL CHECK (answer IN ('yes', 'maybe', 'no')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, user_id)
);

CREATE TABLE IF NOT EXISTS trendsetter_hub.news_banners (
  id         bigserial PRIMARY KEY,
  text       text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 300),
  active     boolean NOT NULL DEFAULT true,
  ends_at    timestamptz,
  created_by bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS news_banners_one_active ON trendsetter_hub.news_banners (active) WHERE active;
```
- `rsvp_names_public` хранится независимо от `rsvp_enabled` (у события можно заранее выставить); у `news` всегда `false` (CHECK).
- Все три таблицы имеют FK на `users` → `TRUNCATE users ... CASCADE` в `conftest.clean` их очищает; **`conftest.py` не менять**. Тесты не полагаются на конкретные id.
- `deploy/stamp_alembic_0009.sql`: `UPDATE trendsetter_hub.alembic_version SET version_num = '0009' WHERE version_num = '0008';` + шапка как у `0008`.
- `0009_news.py` — по образцу `0008_security.py` (`SQL_FILES = ["09_news.sql"]`, `down_revision = "0008"`). **Downgrade**: `DROP TABLE IF EXISTS` `news_rsvp`, `news_items`, `news_banners` (в этом порядке). Строки `module_id='news'` в `user_module_permissions` / `access_group_permissions` **не удаляются** (безвредны: UI перечисляет только `MODULES`; при повторном upgrade редакторы сохраняются) — записать в README.
- `db/README.md` — раздел «Новости (ревизия 0009)» в стиле 0005–0008: таблицы, правило плашки, порядок выката (1. `09_news.sql` под doadmin; 2. `stamp_alembic_0009.sql`; 3. только потом merge в `main`, иначе `/modules/news/*` отвечает 500; 4. выдать «Ответственный» на «Новости» ассистенту-редактору в «Особых правах»), откат.

## Бэкенд
Файлы модуля: `backend/app/modules/news/__init__.py`, `service.py`, `router.py` (`APIRouter(prefix="/modules/news", tags=["news"])`). Манифест в `backend/app/core/registry.py`: `ModuleManifest("news", "Новости", "mvp", news_router, for_all=True)` — **последней строкой** `MODULES`. SQL — через `text()` с константой префикса (стиль `modules/hr/service.py`); ORM-модели в `core/models.py` **не добавлять**.

**Время.** Функция модуля `_now() -> datetime` (UTC, aware) подменяется в тестах. Все сравнения «прошло / открыто / истекло» делаются с параметром `:now` из `_now()`, **не** с SQL `now()` (кроме DEFAULT у `created_at` / `updated_at`). `updated_at` при правке — из `_now()`.

**Права (зависимости в `router.py`):**
- `reader` — `get_current_user` + `can_read(access) = can_see_data(access)` (`view` / `run`), иначе 403 (viewer — 403).
- `editor` — `is_editor(...)`, иначе 403. Редактор проходит и проверки читателя (даже если у него уровень viewer с `responsible`).
- Черновики **никогда** не отдаются не-редактору: для него черновик = 404 (RSVP, `responses`).

**Валидация** (422 с русским текстом; общий обработчик уже превращает ошибки pydantic в `messages.INVALID`):
- Строки обрезаются (`strip`). `title` 1..200; `body` ≤ 5000 (может быть пустым); `place` 1..200 или `null` (пустая строка → `null`).
- Дата-время — ISO 8601 **с часовым поясом** (`Z` или смещение); без зоны → 422.
- Проверки — по **итоговому состоянию** записи (после слияния PATCH с текущими значениями), зеркалят CHECK из SQL: `event` — `startsAt` обязателен; `endsAt >= startsAt`; `rsvpDeadline <= startsAt`; у `news` поля `startsAt`, `endsAt`, `place`, `rsvpDeadline` = `null`, `rsvpEnabled = false`, `rsvpNamesPublic = false`.
- `kind` задаётся только при создании; в PATCH — 422 (модель PATCH с `extra='forbid'`). «Поле не передано» и «передано null» различаются через `model_fields_set`.
- Плашка: `text` 1..300; `endsAt` — будущее время или `null` (прошедшее → 422).
- Тексты ошибок — константы в `service.py` (например, «Укажите дату и время начала», «Окончание раньше начала», «Срок ответа позже начала события», «Голосование для этой записи не включено», «Приём ответов закрыт»); общие — из `core/messages.py` (`FORBIDDEN`, `NOT_FOUND`, `INVALID`).

### Объект записи (`Item`)
```json
{
  "id": 12,
  "kind": "event",
  "title": "Выезд на природу",
  "body": "Сбор у офиса в 08:30\nАвтобус в 09:00\nВозврат около 19:00\nВзять: удобную обувь, дождевик",
  "place": "Дилижан",
  "startsAt": "2026-11-07T05:00:00+00:00",
  "endsAt": "2026-11-07T15:00:00+00:00",
  "pinned": true,
  "status": "published",
  "archived": false,
  "publishedAt": "2026-10-26T09:12:00+00:00",
  "updatedAt": "2026-10-26T09:12:00+00:00",
  "rsvpEnabled": true,
  "rsvpDeadline": "2026-11-05T18:00:00+00:00",
  "rsvpNamesPublic": false,
  "rsvp": {"open": true, "counts": {"yes": 4, "maybe": 2, "no": 1}, "myAnswer": "yes", "canSeeNames": false}
}
```
- Даты — `isoformat()` aware-значений; `null`, если нет.
- `rsvp` = `null`, если `rsvpEnabled = false`. Иначе: `open` = опубликовано, не в архиве, событие не прошло и `now < coalesce(rsvp_deadline, starts_at)`; `counts` — только ответы **активных** пользователей (`users.is_active`), все три ключа присутствуют всегда; `myAnswer` — ответ текущего пользователя или `null`; `canSeeNames` = `is_editor OR rsvp_names_public` (подсказка фронту, показывать ли «Кто идёт»).
- У `kind = "news"`: `place`, `startsAt`, `endsAt`, `rsvpDeadline` = `null`, `rsvpEnabled = false`, `rsvpNamesPublic = false`, `rsvp = null`.
- При выключении RSVP ответы **сохраняются** в БД, но не отдаются; при повторном включении возвращаются.

### Эндпоинты (все под `/modules/news`; без токена — 401)
| Метод и путь | Кто | Ответ |
|---|---|---|
| `GET /feed` | reader | `{"events": [Item], "news": [Item]}` — для главной |
| `POST /items/{id}/rsvp` `{"answer": "yes"\|"maybe"\|"no"}` | reader | `Item` (с обновлённым `rsvp`) |
| `GET /items/{id}/responses` | editor; reader — только если `rsvpNamesPublic = true` | `{"yes": [Resp], "maybe": [Resp], "no": [Resp]}`, `Resp = {"userId", "name", "updatedAt"}` |
| `GET /banner` | reader | `{"banner": {"id", "text", "endsAt"} \| null}` |
| `GET /items?tab=current\|past\|drafts&limit=20&offset=0` | editor | `{"items": [Item], "total": N}` — для админки в профиле |
| `POST /items` | editor | `Item` (созданная запись) |
| `PATCH /items/{id}` | editor | `Item` |
| `POST /items/{id}/delete` | editor | `{"ok": true}` |
| `POST /banner` `{"text", "endsAt": iso \| null}` | editor | `{"banner": {...}}` |
| `POST /banner/off` | editor | `{"banner": null}` |

DELETE/PUT не используются (CORS разрешает только GET/POST/PATCH; конвенция проекта — `POST .../{id}/delete`).

**Выборки:**
- `GET /feed` (только `status='published'`): `events` — `kind='event'`, не в архиве, `coalesce(ends_at, starts_at) >= :now`; порядок `pinned DESC, starts_at ASC, id ASC`; не более **5**. `news` — `kind='news'`, не в архиве; порядок `pinned DESC, published_at DESC, id DESC`; не более **5** (давность не ограничивается — `TODO(Q-N9)`).
- `tab=current` (editor): опубликованные с условиями `events` и `news` из `/feed`, с пагинацией `limit` / `offset` вместо лимита 5; порядок `pinned DESC, (kind='news') ASC, starts_at ASC NULLS LAST, published_at DESC, id DESC`.
- `tab=past` (editor): опубликованные, `archived OR (kind='event' AND coalesce(ends_at, starts_at) < :now)`; порядок `coalesce(starts_at, published_at) DESC, id DESC`.
- `tab=drafts` (editor): `status='draft'` (флаг архива не учитывается); порядок `updated_at DESC, id DESC`.
- `limit` 1..100, `offset >= 0`, иначе 422; неизвестный `tab` — 422.

**Создание и правка:**
- POST: `kind` (обязателен), `title` (обязателен), `body` (по умолчанию `""`), `place`, `startsAt`, `endsAt`, `pinned` (false), `rsvpEnabled` (false), `rsvpDeadline`, `rsvpNamesPublic` (false), `status` (`draft` по умолчанию). При `status='published'` — `published_at = _now()`.
- PATCH: любые из `title, body, place, startsAt, endsAt, pinned, rsvpEnabled, rsvpDeadline, rsvpNamesPublic, status, archived`. `draft → published` ставит `published_at = _now()` только если он был `null` (повторная публикация дату не меняет). `published → draft` разрешён («Снять с публикации»). `archived` можно менять у любой записи.
- Несуществующий `id` — 404.

**RSVP:** записи нет или черновик — 404; `kind='news'` или `rsvpEnabled=false` — 409 «Голосование для этой записи не включено»; в архиве, прошедшее или `now >= coalesce(rsvp_deadline, starts_at)` — 409 «Приём ответов закрыт». Иначе upsert (`INSERT ... ON CONFLICT (item_id, user_id) DO UPDATE SET answer, updated_at`). Отозвать ответ нельзя — только сменить (`TODO(Q-N10)`).

**`GET /items/{id}/responses`:**
- Редактору — для любой записи (включая черновик, архив, прошедшее). Читателю-не-редактору — только опубликованная запись с `rsvpEnabled = true` и `rsvpNamesPublic = true`; черновик или записи нет — 404; имена закрыты (`rsvpNamesPublic = false`) или RSVP выключен — 403. Архивное / прошедшее опубликованное событие с публичными именами — 200 (только чтение).
- Только активные пользователи; имя — `users.full_name`; сортировка по имени. Несуществующий `id` — 404.

**Плашка:**
- `GET /banner`: строка с `active = true` и (`ends_at IS NULL OR ends_at > :now`), иначе `null`.
- `POST /banner`: если есть активная строка с **тем же** текстом (после `strip`, точное совпадение; истёкшая тоже считается) — обновить её `ends_at` / `updated_at`, id сохраняется, журнал `news.banner_update`. Иначе в одной транзакции: все активные → `active=false`, вставить новую активную строку, журнал `news.banner_set`. Нарушение уникального индекса при одновременных запросах → 409 (не 500).
- `POST /banner/off`: все активные → `active=false`; журнал `news.banner_off` с `banner_id` выключенной. Если активной не было — 200 `{"banner": null}` без записи в журнал.

**Журнал** (`log_action(session, user.id, action, module_id="news", **details)`, коммит вместе с действием):

| Действие | Когда | `details` |
|---|---|---|
| `news.create` | POST /items | `news_id`, `kind`, `status` |
| `news.update` | PATCH изменил что-то кроме `status` / `archived` | `news_id`, `fields` (отсортированный список camelCase-имён реально изменившихся полей, в т. ч. `rsvpNamesPublic`) |
| `news.publish` / `news.unpublish` | смена `status` | `news_id` |
| `news.archive` / `news.unarchive` | смена `archived` | `news_id` |
| `news.delete` | удаление | `news_id`, `kind` |
| `news.banner_set` / `news.banner_update` / `news.banner_off` | плашка | `banner_id` |

Один PATCH может дать несколько записей (например, `news.update` + `news.publish`). PATCH без реальных изменений — без записей. Текстов (`title`, `body`, `place`, текст плашки) в `details` нет. Просмотр `responses` не журналируется.

## Фронтенд

### Реестр (`frontend/src/modules/registry.js`)
- `MODULES` — последней строкой: `{ id: 'news', status: 'mvp', hidden: true, forAll: true, strings: newsStrings, Component: null }`. `forAll: true` обязателен (mock `accessTo` читает его из фронтового реестра). `hidden: true` — новый необязательный флаг: модуль есть в «Особых правах» и в таблице прав групп (`GroupsTab`), но не в меню, не в «Моих инструментах» и без страницы. Описать флаг в комментарии над `MODULES`.
- `PROFILE_SECTIONS` — новая запись в конце: `{ id: 'news', label: newsStrings.profile.title, visible: (me) => isNewsEditor(me), Component: lazy(() => import('./news/NewsAdminSection.jsx')) }` (без `load`).
- `HOME_WIDGETS` получает необязательное поле **`slot`**: `'banner'` — над hero; `'top'` — на всю ширину между «Моими инструментами» и сеткой; не указано — в сетку `.home-grid` (как сейчас ДР и отпуска). Обновить комментарий с описанием полей. Новые записи:
  ```js
  { id: 'news-banner', slot: 'banner', visible: canReadNews, Component: lazy(() => import('./news/components/HomeBanner.jsx')) },
  { id: 'news', slot: 'top', visible: canReadNews, Component: lazy(() => import('./news/components/HomeNews.jsx')) },
  ```
  (`canReadNews(me) = canSeeData(me.module_access.news)`, `isNewsEditor` — из `./news/lib/news.js`). Невидимый виджет не рендерится и запросов не делает — у viewer ни одного запроса к `/modules/news/*`. Будущий блок «Соцсети» добавится ещё одной записью со `slot: 'top'`; заглушку не рисовать.

### Ядро: скрытые модули (минимальные правки)
- `frontend/src/core/layout/AppLayout.jsx`: `navModules` строится из `MODULES.filter((m) => !m.hidden)` (индексы `idx` остальных модулей не меняются, т. к. `news` последний).
- `frontend/src/core/pages/HubPage.jsx`: `visibleModules` дополнительно отбрасывает `m.hidden` (полоса и счётчик `[NN]`).
- `frontend/src/core/pages/ModulePage.jsx`: `if (!module || module.hidden) return <NotFoundPage />`.
- `UserPermissionsModal`, `GroupsTab`, `RoadmapPlaceholder`, mock — **без фильтра** (там `news` должен быть).

### Главная (`frontend/src/core/pages/HubPage.jsx`)
Порядок сверху вниз: **виджеты `slot: 'banner'` → hero → «Мои инструменты» → виджеты `slot: 'top'` → `.home-grid` (часы, погода, курсы, виджеты без `slot`)**. Хелпер `widgetsOf(slot)` фильтрует `HOME_WIDGETS` по `(w.slot ?? null) === slot && w.visible(me)`. Для `slot: 'banner'` — `Suspense` с `fallback={null}` (без спиннера и скачка раскладки); остальные — как сейчас (`Spin size="small"`). Кроме слотов и фильтра `hidden` в `HubPage` ничего не менять; hero, полоса и CSS ядра — как в коммите раскладки.

### Плашка (`modules/news/components/HomeBanner.jsx`)
- Грузит `GET /modules/news/banner` один раз при монтировании. Загрузка / ошибка / `banner: null` / id скрыт → `return null`.
- Разметка: полоса во всю ширину `.stack.home`, фон `var(--red)`, белый текст, `role="alert"`; текст `white-space: pre-wrap`; справа кнопка «Скрыть» (`aria-label` из строк). Без анимации и прокрутки.
- `localStorage`: ключ `hub.news.hiddenBanner`, значение — строка id последней скрытой плашки. Чтение/запись — через чистые функции `isBannerHidden(storage, id)` / `hideBanner(storage, id)` в `lib/news.js`, обе в `try/catch` (исключение → «не скрыта» / тихо игнорировать).

### Блок «Новости» на главной (`modules/news/components/HomeNews.jsx`)
- Грузит `GET /modules/news/feed`. Загрузка — `Spin size="small"` в карточке. Ошибка — карточка с текстом «Не удалось загрузить новости». **Оба списка пустые — блок не рендерится** (`return null`).
- Карточка `.home-card` на всю ширину; внутри две колонки (от 900px; уже — одна): «Ближайшие события» и «Новости». Пустая колонка — короткий текст («Ближайших событий нет» / «Новостей пока нет»).
- Строка события: дата-время начала (`formatDateTime`, mono) — заголовок — место (muted); закреплённое — mono-метка «Закреплено»; если `rsvp` не `null` — счётчики «Иду N · Думаю N · Не иду N»; если `rsvp.open` — компонент `RsvpControl` (компактный `Segmented` Иду / Думаю / Не иду с текущим `myAnswer`); клик → `POST .../rsvp`, при успехе — подмена записи из ответа, при ошибке — `message.error(e.message)`. `rsvp` есть, но `open = false` — метка «Приём ответов закрыт».
- Строка новости: дата публикации, заголовок, первые 160 символов `body` (чистая функция `excerpt(text, 160)` с «…»).
- Клик по заголовку — `NewsItemModal` (полный текст `pre-wrap`, начало/окончание, место, срок ответа, `RsvpControl`; если `rsvp.canSeeNames` — раздел «Кто идёт» с тремя списками имён из `GET .../responses`, загружается при открытии модалки; ошибка загрузки списка — короткий текст, модалка работает). Ссылки «Все новости» нет (у сотрудников нет страницы ленты). Редактору в модалке — ссылка «Управлять» на `/profile?section=news`.

### Админка: вкладка профиля (`modules/news/NewsAdminSection.jsx`, `/profile?section=news`)
- Видна только при `isNewsEditor(me)` (через `PROFILE_SECTIONS.visible`); компонент получает `{ me, data, reload }` как остальные разделы профиля.
- Сверху — панель «Срочная плашка» (`BannerEditor`): текущая плашка (текст, «до …»), форма «Текст» (`Input.TextArea`, maxLength 300, showCount) + «Действует до» (необязательно) + «Показать», кнопка «Выключить». Подсказка: «Изменение текста покажет плашку заново даже тем, кто её скрыл».
- Ниже — `Segmented`: «Актуальное» (`tab=current`), «Прошедшие и архив» (`tab=past`), «Черновики» (`tab=drafts`); пагинация по 20; кнопка «Добавить» → `NewsEditorDrawer`.
- У каждой записи: статус (черновик / опубликовано / в архиве), «Изменить» (тот же Drawer), «Опубликовать» / «Снять с публикации», «В архив» / «Вернуть из архива», «Ответы» (если `rsvpEnabled`; `ResponsesModal`: счётчики + три списка имён), «Удалить» (`Popconfirm`).
- `NewsEditorDrawer`: при создании — `Radio` «Новость / Событие» (у существующей записи скрыт). Поля: «Заголовок» (maxLength 200); для события — «Начало» (обязательно), «Окончание» (подсказка «Без окончания событие скроется в момент начала»), «Место»; «Описание / программа» (`Input.TextArea autoSize`, maxLength 5000, showCount, placeholder с примером: выезд, возврат, транспорт, что взять с собой); «Закрепить» (`Switch`); для события — «Голосование „Кто пойдёт“» (`Switch`), «Принимать ответы до» (необязательно) и **«Показывать всем, кто идёт»** (`Switch` → `rsvpNamesPublic`, по умолчанию выключен; подсказка «Выключено — имена видите только вы, сотрудники видят только счётчики»). Кнопки: «Сохранить черновик» и «Опубликовать» (у опубликованной — «Сохранить»). Клиентская валидация зеркалит серверную; ошибка сервера — `message.error(e.message)`.
- Ввод даты-времени: `<Input type="datetime-local" />` (без dayjs — его нет в `package.json`, импортировать нельзя). Преобразование — чистые функции `toLocalInput(iso) -> 'YYYY-MM-DDTHH:MM'` (зона браузера) и `fromLocalInput(value) -> ISO с Z | null` в `lib/news.js`.

### Особые права (`frontend/src/core/admin/UserPermissionsModal.jsx`)
Единственная правка: у `Form.Item` модуля — `extra={m.strings.permissionHint}` (необязательное поле строк модуля; у остальных модулей его нет, вывод не меняется). У `news`: `permissionHint: '«Ответственный» — редактор новостей и срочной плашки (вкладка «Новости» в профиле)'`.

### Строки
- `frontend/src/modules/news/strings.js` (конвенция модулей, как `team/strings.js`; решение Q-H1): `dept` («Компания»), `tool` / `title` / `name` («Новости» — нужны «Особым правам» и группам), `description`, `permissionHint`, `profile.title` («Новости»), `home` (заголовки колонок, пустые состояния, «Закреплено», «Управлять», ошибка загрузки), `rsvp` (`yes` / `maybe` / `no`, `closed`, `counts(...)`, `deadline(date)`, `whoTitle`, `namesLoadError`), `admin` (вкладки, кнопки, статусы, подтверждения, пустые состояния), `editor` (подписи полей, подсказки, ошибки валидации), `banner` (`hide`, `hideLabel`, редактор плашки), `errors`.
- В JSX нет текстовых литералов, кроме `·`, `→`, `…`. `core/strings.js` не меняется.

### Стили
`frontend/src/modules/news/news.css` (импортируется компонентами модуля, как `team.css`): классы с префиксом `.news-` (плашка, две колонки блока, строки события/новости, `pre-wrap`-текст, медиазапрос 900px). Только существующие токены (`--red`, `--border`, `--muted`, `.mono`, `.home-card`, `.home-card-head`). `core/styles.css` не менять.

### Mock (`VITE_DEMO_MODE`)
- Новый `frontend/src/core/api/mock/news.js`: фабрика `createNewsHandlers({ userFromToken, accessTo, isEditor, now = () => new Date() })` → `{ handlers }` со всеми эндпоинтами из таблицы: тот же контракт, права (reader = `canSeeData(accessTo(user, 'news'))`, viewer — 403), коды ошибок и правила (прошедшее, `rsvp.open`, `canSeeNames`, `responses` по `rsvpNamesPublic`, черновик = 404 не-редактору, правило id плашки, только активные пользователи в счётчиках и именах). Журнал в mock не ведётся.
- Демо-данные — относительно `now()`: 2 будущих события (одно закреплено, с RSVP, сроком ответа, многострочной программой и `rsvpNamesPublic: true`; второе с RSVP и `rsvpNamesPublic: false`), 1 прошедшее, 3 новости (одна закреплена), 1 черновик, 1 в архиве; несколько ответов RSVP от демо-пользователей; активная плашка. Все люди и тексты вымышленные.
- `mock/handlers.js`: создание фабрики (`isEditor = (u) => isModuleResponsible(u, groupPermissionsOf(u, 'news')) || canManageUsers(u)`) и регистрация спредом в `handlers`.
- `mock/data.js`: в `userModulePermissions` добавить `9: { news: 'responsible' }` («Сотрудник HR» — демо-редактор). Больше ничего в `data.js` не менять.

## Файлы
**Создаются**
- `db/09_news.sql`, `deploy/stamp_alembic_0009.sql`, `backend/alembic/versions/0009_news.py`
- `backend/app/modules/news/__init__.py`, `service.py`, `router.py`
- `backend/tests/test_news.py`
- `frontend/src/modules/news/strings.js`, `news.css`, `NewsAdminSection.jsx`
- `frontend/src/modules/news/lib/news.js`, `lib/news.test.js`
- `frontend/src/modules/news/components/HomeBanner.jsx`, `HomeNews.jsx`, `NewsItemModal.jsx`, `RsvpControl.jsx`, `NewsEditorDrawer.jsx`, `ResponsesModal.jsx`, `BannerEditor.jsx`
- `frontend/src/core/api/mock/news.js`, `news.test.js`

**Меняются**
- `backend/app/core/registry.py` — импорт роутера и одна строка манифеста.
- `backend/tests/test_database.py` — ожидаемая версия `0009` (+ проверка прав hub_app на `news_*`).
- `backend/tests/test_me.py` — в ожидаемый `module_access` добавить `news` (у admin — `run`). Остальные тесты, перечисляющие `MODULES` (`test_warehouse.py` строки 323/326), строятся по реестру и правки не требуют — проверить прогоном.
- `frontend/src/modules/registry.js` — `MODULES` (+news с `hidden`), `PROFILE_SECTIONS` (+news), `HOME_WIDGETS` (`slot`, две записи), комментарии.
- `frontend/src/core/layout/AppLayout.jsx` — фильтр `!m.hidden` в меню.
- `frontend/src/core/pages/HubPage.jsx` — слоты `banner` / `top` и фильтр `!m.hidden` в полосе.
- `frontend/src/core/pages/ModulePage.jsx` — `hidden` → `NotFoundPage`.
- `frontend/src/core/admin/UserPermissionsModal.jsx` — `extra={m.strings.permissionHint}`.
- `frontend/src/core/api/mock/handlers.js` — фабрика news + регистрация.
- `frontend/src/core/api/mock/data.js` — одна запись в `userModulePermissions`.
- `db/README.md` — раздел «Новости (ревизия 0009)».
- `docs/TZ-news.md` — раздел «Отступления реализации» по итогам.

**Не трогать:** существующие `db/*.sql` и `deploy/stamp_*.sql`, ревизии `0001–0008`, `backend/tests/conftest.py`, `core/models.py`, `core/access.py` / `access.js`, `routes_admin.py`, `routes_core.py`, `/core/me`, HR/team (бэкенд и фронт, включая HR-журнал и его словарь действий), `core/strings.js`, `core/styles.css`, `ProfilePage.jsx`, `GroupsTab`, `RoadmapPlaceholder`, `core/home/*`, `requirements.txt`, `package.json`, `vite.config.js`, `ARCHITECTURE.md`, `CLAUDE.md`, репозиторий purchasing_dashboard. Нужен другой файл — остановиться и вернуть вопрос.

## Тесты
**Бэкенд — `backend/tests/test_news.py`** (с БД через фикстуры `client` / `db`; без `HUB_TEST_ADMIN_DSN` пропускаются; `service._now` подменяется через `monkeypatch` там, где важна граница времени). Пользователи: admin, superuser, employee, viewer, employee-редактор (`UserModulePermission(module_id='news', permission='responsible')`), неактивный.
1. Права: без токена 401 на всех эндпоинтах. viewer — **403** на `/feed`, `GET /banner`, `rsvp`, `responses` и всех редакторских. employee — 200 на `/feed`, `GET /banner`, RSVP; 403 на `GET /items` (любой `tab`), POST/PATCH/delete, запись плашки. Редактор (responsible) и admin — всё 200. superuser без права — читатель, 403 на редакторских.
2. Черновик: не виден в `/feed`, `current`, `past`; не-редактору — 404 на `rsvp` и `responses`; виден в `drafts` редактору.
3. Валидация (все 422): event без `startsAt`; `endsAt < startsAt`; `rsvpDeadline > startsAt`; news с `place` / `startsAt` / `rsvpEnabled` / `rsvpNamesPublic = true`; дата без зоны; `title` пустой / 201 символ; `body` 5001; `kind` в PATCH; неизвестный `tab`; `limit` 0 и 101; PATCH, делающий итог невалидным (снять `startsAt` у события).
4. Выборки и время (`_now` подменён): событие с `ends_at` в прошлом и событие без `ends_at` со `starts_at` в прошлом → не в `/feed` / `current`, есть в `past`; закреплённое прошедшее — тоже не в `/feed`; архивное → только в `past`; порядок `/feed` (закреплённые первыми, события по `startsAt`, новости по `publishedAt` убыв.); лимит 5.
5. Публикация: `draft → published` ставит `publishedAt`; повторная публикация после снятия его не меняет.
6. RSVP: смена ответа — upsert (счётчики, `myAnswer`); после `rsvpDeadline` → 409; без срока — после `startsAt` → 409; в архиве → 409; news / выключенный RSVP → 409; неактивный пользователь не входит в `counts` и `responses`; выключение RSVP → `rsvp: null`, повторное включение возвращает прежние счётчики; `responses` отсортированы по имени.
7. Видимость имён: `rsvpNamesPublic = false` — employee получает 403 на `responses`, `rsvp.canSeeNames = false`, счётчики есть; редактор — 200 и `canSeeNames = true`. После PATCH `rsvpNamesPublic = true` — employee 200 со списками по группам и `canSeeNames = true`; viewer — по-прежнему 403. PATCH `rsvpNamesPublic` пишет `news.update` с `fields = ["rsvpNamesPublic"]`.
8. Плашка: POST создаёт активную; POST с тем же текстом и новой датой — тот же `id`; POST с другим текстом — новый `id`, старая неактивна; `off` → `GET` даёт `null`; истёкшая (`ends_at < _now`) → `null`; в БД `count(*) WHERE active` ≤ 1 после серии операций; `endsAt` в прошлом → 422.
9. Журнал: на каждое действие из таблицы — запись с правильным `action`, `module_id='news'` и `details` только из перечисленных ключей; ни в одной записи нет заголовка / текста / места / текста плашки (проверка подстрокой по `json.dumps(details)`, без поля `at`); RSVP и просмотр `responses` записей не создают; PATCH без изменений — без записей.
10. `test_database.py`: версия `0009`; роль `hub_app` может читать/писать `news_*` и использовать их последовательности. `test_me.py`: `module_access` содержит `news`.

**Фронтенд (`node --test`)**
- `lib/news.test.js`: `isNewsEditor` (responsible / admin / superuser без права / employee); `canReadNews` (viewer `structure` → false, employee `view` → true, `run` → true, `none` → false); `toLocalInput` / `fromLocalInput` (обратимость, пустое → `null`); `excerpt` (короче лимита — без «…», длиннее — обрезка + «…»); `isBannerHidden` / `hideBanner` с фейковым `storage` и со `storage`, бросающим исключение (→ `false`, исключение наружу не выходит).
- `mock/news.test.js`: 401 без токена; viewer — 403 на `feed` и `banner`; не-редактор — 403 на `items` и редакторских, 404 на RSVP черновика; `responses` для employee: 403 при `rsvpNamesPublic = false`, 200 при `true`; прошедшее событие уходит из `feed` в `past` при сдвинутом `now`; RSVP после срока → 409; правило id плашки (тот же текст → тот же id, новый текст → новый id); в демо-данных `feed` содержит закреплённое событие с RSVP.
- Прогоны: `npm test`, `npm run lint`, `npm run build`, `pytest`.

## Закрытые вопросы (решения пользователя 2026-10-26)
- **Q-N1** → viewer новости **не видит**: ни ленту, ни плашку, ни RSVP; эндпоинты читателя — 403; на главной блоки не рендерятся и запросов не делают (решение 4).
- **Q-N2** → видимость имён — настройка события `rsvpNamesPublic` (по умолчанию только редактор); счётчики видят все читатели (решение 5).
- **Q-N5** → админка только редакторам, вкладка «Новости» в профиле; модуль скрыт из меню и «Моих инструментов» флагом `hidden`; сотрудникам — только блок на главной, без архива (решения 2 и 6).

## Открытые вопросы
- **Q-N3**: superuser (руководитель) не редактор без явного права. Нужно ли автоматически?
- **Q-N4**: опции `view` / `run` у «Новостей» в «Особых правах» и группах ни на что не влияют (кроме viewer через Q-G1). Оставить или скрыть для этого модуля?
- **Q-N6**: часовой пояс: ввод и показ — в зоне браузера. Показывать время события в зоне места (Ереван / Москва) с подписью?
- **Q-N7**: событие без окончания исчезает с главной в момент начала. Держать до конца дня (в зоне `HUB_TIMEZONE`)?
- **Q-N8**: кликабельные ссылки в тексте (автоссылки) — нужны ли.
- **Q-N9**: новости на главной не устаревают сами (только архив вручную). Скрывать новости старше N дней?
- **Q-N10**: отзыв ответа RSVP («убрать мой ответ») — нужен ли.
- **Q-N11**: уведомления (колокольчик) о новом событии / плашке — не в этом этапе; нужны ли позже.
- **Q-N12**: просмотр журнала `news.*` в интерфейсе (сейчас только в БД).

## Проверка фактов (technical-analyst, до старта реализации)
- **T-N1**: `<input type="datetime-local">` через antd `Input type=...` — поддержка в целевых браузерах (Chrome / Edge / Safari / Firefox desktop), формат значения `YYYY-MM-DDTHH:MM`, пустое значение; `new Date('YYYY-MM-DDTHH:MM')` трактуется как локальное время (ES2015+). Альтернатива — antd `DatePicker showTime`, но ему нужен `dayjs` для начальных значений (в `package.json` его нет).
- **T-N2**: частичный уникальный индекс `(active) WHERE active`; идемпотентность `CREATE UNIQUE INDEX IF NOT EXISTS`; `INSERT ... ON CONFLICT DO UPDATE` под ролью hub_app (нужны только INSERT / UPDATE).
- **T-N3**: pydantic v2 — отказ на naive `datetime` (`AwareDatetime`), `ConfigDict(extra='forbid')` + `model_fields_set` для PATCH.

---

## План
1. БД: `db/09_news.sql`, `0009_news.py`, `stamp_alembic_0009.sql`, раздел в `db/README.md`; `test_database.py` → `0009` → проверка: `alembic upgrade head` и `alembic downgrade 0008` на локальном Postgres из compose; повторный прогон SQL без ошибок; `pytest backend/tests/test_database.py`.
2. Бэкенд: `modules/news/service.py` (права, валидация, выборки, RSVP и видимость имён, плашка, журнал, `_now`) + `router.py` + строка в `registry.py`; `test_me.py` (+news) → проверка: `pytest backend/tests/test_news.py backend/tests/test_me.py`, затем полный `pytest` (в т. ч. `test_warehouse.py`).
3. Фронт: `modules/news/lib/news.js` + тесты → проверка: `npm test`.
4. Фронт: `mock/news.js` + тест, регистрация в `handlers.js`, запись в `data.js` → проверка: `npm test`.
5. Фронт: реестр (`hidden`, `PROFILE_SECTIONS`, `HOME_WIDGETS.slot`) и минимальные правки ядра (`AppLayout`, `HubPage`, `ModulePage`, `UserPermissionsModal`) → проверка: `npm run lint`, `npm run build`; в демо пункта «Новости» нет в меню и в «Моих инструментах», `/modules/news` — «Не найдено», строка «Новости» есть в «Особых правах».
6. Фронт: `strings.js`, `news.css`, компоненты главной (`HomeBanner`, `HomeNews`, `NewsItemModal`, `RsvpControl`) и админки (`NewsAdminSection`, `NewsEditorDrawer`, `ResponsesModal`, `BannerEditor`) → проверка: `npm run lint`, `npm run build`; демо под admin, «Сотрудник HR» (редактор), employee, viewer на 1440px и 800px.
7. Дописать «Отступления реализации» в этот файл.

## ТЗ для исполнителя
Делать строго по разделам «Решения», «Данные», «Бэкенд», «Фронтенд», «Файлы», «Тесты». Дополнительно:
- Начинать **после** коммита правки раскладки главной в `home-layout`; если её нет в истории — остановиться и спросить.
- Менять только файлы из списка «Файлы». Нужен другой файл — остановиться и вернуть вопрос. Существующие `.sql`, ревизии `0001–0008` и `conftest.py` не трогать.
- Никаких новых зависимостей (Python / npm), никакого прямого `import dayjs`.
- Права — только через `module_rights` / `can_manage_users` / `can_see_data` (бэкенд) и `me.module_access` / `me.module_responsible` / `me.can_manage_users` (фронт); новых столбцов и таблиц прав не вводить. Единственный новый флаг — `hidden` во фронтовом `MODULES`. По одной функции на правило (`can_read`, `is_editor`; `canReadNews`, `isNewsEditor`).
- Никаких `DELETE` / `PUT`; удаление — `POST .../{id}/delete`.
- Время в логике — только через `_now()` параметром в SQL.
- Текст — только plain text (`pre-wrap`), без `dangerouslySetInnerHTML`, без HTML / markdown.
- В `audit_log.details` — только ключи из таблицы журнала; RSVP не журналировать. HR-журнал не трогать.
- Ядро (`frontend/src/core/**`) не импортирует `modules/news/**` — связь только через `modules/registry.js` (`MODULES`, `PROFILE_SECTIONS`, `HOME_WIDGETS`). `UserPermissionsModal` берёт `m.strings.permissionHint` из реестра.
- UI-строки — только в `modules/news/strings.js`.
- Всё спорное — `TODO(Q-Nn)` в коде + запись в «Отступления реализации».

## Критерии приёмки для ревьюера
- [ ] Дифф только по списку «Файлы»; нет правок существующих `.sql` / `stamp_*.sql` / ревизий `0001–0008`, `conftest.py`, `core/models.py`, `access.py` / `access.js`, `routes_admin.py`, `routes_core.py`, HR/team, `core/strings.js`, `core/styles.css`, `ProfilePage.jsx`, `GroupsTab`, `package.json`, `requirements.txt`, `vite.config.js`.
- [ ] `09_news.sql` идемпотентен (повторный прогон без ошибок), только схема `trendsetter_hub`, таблицы с приставкой `news_`, столбец `rsvp_names_public boolean NOT NULL DEFAULT false`, CHECK-и как в ТЗ, частичный уникальный индекс плашки; `0009` выполняет файл по образцу `0008`, downgrade удаляет только три таблицы `news_*`; `stamp_alembic_0009.sql` переводит `0008 → 0009`; README описывает выкат и откат.
- [ ] Право редактора = `responsible` на `news` ИЛИ admin; одна функция на бэкенде и одна на фронте; новых таблиц / столбцов прав нет; «Особые права» и группы показывают «Новости» с подсказкой `permissionHint`.
- [ ] Скрытие: пункта «Новости» нет в левом меню и в «Моих инструментах» ни у кого (счётчик `[NN]` не изменился), номера пунктов меню прежние; `/modules/news` — «Не найдено»; флаг `hidden` описан в комментарии реестра.
- [ ] Админка — вкладка «Новости» в профиле, видна только редактору (responsible или admin); у employee, superuser без права и viewer вкладки нет, и запросов к `GET /items` нет.
- [ ] viewer: 403 на `feed`, `banner`, `rsvp`, `responses`; на главной нет ни плашки, ни блока «Новости», в сетевой вкладке нет запросов к `/modules/news/*`.
- [ ] employee: видит блок на главной и плашку, голосует; `GET /items` — 403; имена видит только у событий с `rsvpNamesPublic = true`, счётчики — всегда; редактор видит имена всегда.
- [ ] Черновик не попадает ни в один ответ не-редактору; 404 на RSVP / `responses` черновика.
- [ ] Контракт JSON точно как в ТЗ (camelCase, `rsvpNamesPublic`, `rsvp: null` при выключенном голосовании, `rsvp.canSeeNames`, три счётчика всегда, даты ISO с зоной); пагинация `{items, total}`; ошибки — русский текст, коды 401 / 403 / 404 / 409 / 422 как описано.
- [ ] Прошедшее (`coalesce(endsAt, startsAt) < now`) скрыто из `/feed` и «Актуального», в т. ч. закреплённое; есть в «Прошедшие и архив» админки; сравнения через `_now()` (SQL `now()` в модуле — только в DEFAULT).
- [ ] RSVP: смена ответа — upsert; закрыт после срока / начала / в архиве (409); неактивные пользователи не считаются и не показываются; при выключении ответы сохраняются.
- [ ] Плашка: тот же текст → тот же id, новый текст → новый id; не больше одной активной; конфликт параллельных запросов — 409; над hero, красная, статичная (без анимации / marquee); «Скрыть» пишет id в `localStorage` с `try/catch`; при ошибке / пустоте / скрытии компонент возвращает `null`, остальная главная работает (проверить в демо, заставив обработчик плашки бросать ошибку).
- [ ] Главная: порядок плашка → hero → «Мои инструменты» → «Новости» (во всю ширину) → сетка; при пустых лентах блок «Новости» не рендерится; раскладка коммита `home-layout` не сломана; на 800px нет горизонтального скролла.
- [ ] `HOME_WIDGETS`: поле `slot` (`banner` / `top` / по умолчанию сетка) описано в комментарии; ДР и отпуска остались в сетке.
- [ ] Журнал: все действия из таблицы с `module_id='news'`; изменение `rsvpNamesPublic` попадает в `fields`; в `details` только разрешённые ключи, без заголовков / текстов (есть тест); RSVP и просмотр имён не журналируются.
- [ ] Текст только `pre-wrap`; в коде нет `dangerouslySetInnerHTML` и импорта `dayjs`; дата-время через `datetime-local` и чистые функции с тестами.
- [ ] `frontend/src/core/**` не импортирует `modules/news/**` (поиск); в JSX нет UI-литералов; строки — в `modules/news/strings.js`.
- [ ] Mock: все эндпоинты с тем же контрактом и правами; демо под admin, «Сотрудник HR» (редактор), employee и viewer — главная и вкладка профиля работают как описано, в консоли нет ошибок.
- [ ] `npm test`, `npm run lint`, `npm run build`, `pytest` — зелёные; `test_database` ожидает `0009`, `test_me` включает `news`.
- [ ] В конце файла есть раздел «Отступления реализации» (или явное «нет»).

---

## Отступления реализации
Открытые вопросы Q-N3, Q-N4, Q-N6…Q-N12 решены вариантом из ТЗ; в коде стоят `TODO(Q-Nn)` (Q-N3 — `service.is_editor`, `lib/news.js`; Q-N4 — `registry.js`; Q-N6 — `lib/news.js`; Q-N7 — `service._is_past`; Q-N8 — `NewsItemModal.jsx`; Q-N9 — `service.feed`; Q-N10 — `service.set_rsvp`; Q-N11, Q-N12 — шапка `service.py`).

Мелкие уточнения, которых в ТЗ не было:
- **RSVP черновика — 404 всем**, включая редактора (в ТЗ: «записи нет или черновик — 404»); `responses` черновика редактору отдаётся.
- Зависимость `reader` пропускает и редактора без `view`/`run` (в реальности редактор всегда имеет `run`, это лишь явное «редактор проходит проверки читателя»).
- Плашка: `endsAt <= now` — 422 (равное текущему считается прошедшим). Для плашки с тем же текстом, но истёкшей, обновляется `ends_at` (id сохраняется), как в ТЗ.
- PATCH без реальных изменений не делает `UPDATE` (`updatedAt` не меняется) и не пишет в журнал. `news.update` не пишется, если менялись только `status` / `archived`.
- PATCH: не-nullable поля (`title`, `body`, `pinned`, `rsvpEnabled`, `rsvpNamesPublic`, `status`, `archived`) с явным `null` — 422; в модели они объявлены как `T = Field(None)`, «не передано» определяется по `model_fields_set`.
- `backend/tests/test_database.py`: помимо версии `0009` добавлен тест `test_app_role_can_use_news_tables` (права hub_app на `news_*` и каскад).
- Mock `core/api/mock/news.js` получает тексты ошибок параметром `errors` (в `handlers.js` — `getModule('news').strings.errors`): ядро не импортирует `modules/news/**`. `updatedAt` в `responses` mock-а — время запроса (per-answer время в mock не хранится).
- `excerpt` обрезает хвостовые пробелы перед «…».
- `news.css` — для строк, которых нет в токенах ядра, использованы `#fff` и `rgba(255,255,255,…)` только внутри красной плашки.

Не проверено: визуальная проверка демо в браузере (1440px и 800px под admin / «Сотрудник HR» / employee / viewer, проверка плашки с падающим обработчиком) не выполнялась — в среде исполнителя нет браузера. Проверены только `npm test`, `npm run lint`, `npm run build`, `pytest` и логика mock-обработчиков тестами.

## Правки после запуска (цвет, раскладка)

1. **Цвет записи.** Столбец `news_items.color text NULL` + `CHECK (color IS NULL OR color IN ('red','green','yellow','blue','pink','gray'))` (`db/10_news_color.sql`, Alembic `0010`, `deploy/stamp_alembic_0010.sql`, раздел в `db/README.md`). Хранится ключ, не hex; `NULL` — нейтральный. API: необязательное `color` (nullable) в `POST`/`PATCH` и во всех ответах; значение вне списка — 422; `null` в `PATCH` сбрасывает цвет. В журнал попадает только имя поля `color` в `fields`. В форме (`NewsEditorDrawer`) — ряд кружков-радио с `aria-label` (первый — «Без цвета»), названия в `modules/news/strings.js` (`editor.colors`). На главной цвет — фон-тинт и акцент слева полным цветом (`.news-row.color-<ключ>` в `news.css`); `blue` — акцент Dark blue `#1D428A`, `gray` — нейтральный `#8A8380` (в палитре серого нет).
2. **Курс рубля к драму.** В блоке курсов вместо «100 AMD = 22,30 ₽» — «1 RUB = X AMD», `X = nominal / value` (то же, что `1 / perUnit`), 2 знака; дельта — изменение этого курса относительно предыдущего дня. USD и EUR без изменений. Строки — `hub.home.ratesRubLabel`, `ratesAmdUnit`.
3. **Раскладка главной.** Под плашкой и hero — три колонки: слева «Новости» (`HomeNewsFeed`, `slot: 'left'`), по центру «Ближайшие события» (`HomeEvents`, `slot: 'center'`), справа столбиком виджеты (часы, погода, курсы, дни рождения, отпуска). `HomeNews` разделён на два компонента, общие части — `NewsRows.jsx` и `useFeed.js` (каждая колонка делает свой `GET /modules/news/feed`). Колонки — отдельные панели с приглушённым фоном (новости — синий, события — жёлтый). Без доступа к новостям (viewer) колонок нет, виджеты — сеткой на всю ширину. Контейнер до 1360px. Слот `top` больше не используется. Три колонки — от 1100px ширины окна, ниже — друг под другом: новости, события, виджеты. **Открытый вопрос:** при окне 1100px контента ~780px (меню слева 240px + поля 80px), при колонке виджетов 280px колонки новостей и событий получаются по ~226px — тесно; вариант — поднять порог до 1280px (одна строка в `core/styles.css`).
4. **«Мои инструменты»** убраны с главной (разметка, стили `.tools-strip`, `.tool-chip*`, строка `toolsTitle`).
5. **Голосование (`RsvpControl`).** Вместо `Segmented` — три кнопки в ряд на всю ширину (высота 36px): «Иду» (зелёная), «Думаю» (жёлтая), «Не иду» (красная); в обычном состоянии приглушённые (светлый фон, цветной текст, тонкая граница), выбранная — насыщенный цвет; `aria-pressed`, фокус-кольцо.
6. **Выкат 0010:** сначала `db/10_news_color.sql` и `deploy/stamp_alembic_0010.sql` под doadmin, затем merge в `main`; иначе `/modules/news/*` отвечает 500.
