# ТЗ: обратная связь от сотрудников (благодарность, предложение, жалоба), в том числе анонимная

Статус: lead, 2026-10-29. Ветка **`feedback`** (локальная, создаётся поверх `onboarding`: там миграции до `0017`). **Ничего не пушить**, `main` не мержить без команды пользователя. Открытые вопросы — префикс `Q-FB*` (`Q-F*` уже занят); в коде — `TODO(Q-FBn)`.

## Задача (пользователь, 2026-10-29)
На главной есть кнопка «Обратная связь». Сотрудник пишет благодарность, предложение, жалобу на что-то или на кого-то. Отправить можно анонимно. Всё приходит HR на разбор. Анонимные сообщения видит ограниченный круг людей. Тема чувствительная: о содержимом не должен знать никто, кроме допущенных.

## Как устроена защита (коротко для пользователя)
«Зашифровать, чтобы через F12 не посмотреть» на стороне браузера не работает: в F12 видно только то, что браузер уже получил, и любой код в браузере можно прочитать. Поэтому защита устроена так:
1. **Права проверяет сервер.** Каждый запрос к списку сообщений сервер проверяет заново. Тому, у кого нет права, он отвечает 403 и данных не отдаёт. Браузер обычного сотрудника, HR без права или superuser не получает ни одного чужого сообщения, поэтому в F12 нечего смотреть. Скрыть пункт меню — только удобство. Защищает проверка на сервере.
2. **Текст в БД зашифрован** ключом `HUB_PII_KEY` (Fernet, `app/core/crypto.py`), тем же, что и ПДн в HR. Тот, у кого есть дамп или прямой доступ к БД, но нет ключа, видит `enc:v1:…`, а не текст. Без ключа сервер сообщение не принимает (503). Открытым текстом не пишет никогда, это дополнительно проверяет `CHECK` в БД.
3. **Об анонимном авторе сервер ничего не хранит.** В момент запроса сервер, конечно, знает, кто отправляет (нужен вход). Но автор не записывается ни в таблицу, ни в журнал (`audit_log`), ни в уведомления, ни в логи приложения. Восстановить автора потом невозможно, в том числе администратору.

Чего эта схема **не** защищает: человек с доступом к самому серверу (ключ + логи uvicorn с адресом источника и временем) теоретически может сопоставить время и IP. См. `Q-FB1`.

## Решения

1. **Новый модуль `feedback`** («Обратная связь»). Ядро о нём не знает: строка в `MODULES` бэкенда (`core/registry.py`) и строки в `MODULES`, `PROFILE_SECTIONS`, `HOME_WIDGETS` фронта (`modules/registry.js`). Файлы `HubPage.jsx`, `asideWidgets.js`, `widgetConfig.js`, `routes_core.py`, `access.py`, `deps.py`, `audit.py`, `notifications.py`, `crypto.py`, `main.py` **не меняются**.
   - Манифест: `ModuleManifest("feedback", "Обратная связь", "mvp", feedback_router, for_all=True, badge=feedback_service.badge)`. `daily_job` и `home_editor` не задаются. Строка добавляется **в конец** списка.
2. **Права.**
   - **Отправитель** — `can_see_data(access)` на `feedback`. Через `for_all` право `view` получают все активные сотрудники (employee, superuser, admin). **viewer** (`structure`) получает 403, кнопка у него не рендерится (правило «viewer без данных»; пересмотр — `Q-FB2`). Новичок на онбординге отсекается `get_current_user`.
   - **Читатель** («разбирающий») — `module_rights(session, user, ["feedback"])["feedback"][1]` (право `responsible`, личное или групповое) **или** `can_manage_users` (admin). **`module_access` для читателя не используется**: через `compute_module_access` superuser и любой, у кого в «Особых правах» стоит `view`/`run` на feedback, получают `run`/`view`, но читателями **не** становятся. Поэтому для читательских маршрутов нельзя использовать `can_see_data`, `can_run` и `require_module_run`. superuser без права — не читатель (`TODO(Q-FB3)`).
   - Право `responsible` на feedback, выданное **группе**, делает читателями всех её участников. Так задумано, но выдавать его лучше лично через «Особые права».
   - HR (responsible на `hr`) **без** права на `feedback` — не читатель.
   - Чужие сообщения читателям недоступны по маршрутам `/mine`, автору — по маршрутам читателя (403).
3. **Анонимность (главное).** Автор выбирает «С моим именем» или «Анонимно».
   - При анонимной отправке `author_id = NULL`, `is_anonymous = true`, `contact_ok = false`. В `audit_log` **нет ни одной строки**, даже с `user_id = NULL`: `audit_log.at` хранит точное время, это лишний канал корреляции. В логгеры приложения ничего не пишется. Ответ — `{"ok": true}` без id.
   - При отправке с именем `author_id` — автор. Пишется `log_action(session, user.id, "feedback.create", "feedback", id=…, kind=…)` без текста.
   - Уведомление о новом сообщении получают **все** читатели, **включая самого автора, если он читатель**. Если исключить автора-читателя, в пачке уведомлений не хватит ровно одной строки, и это укажет на автора.
   - Галочка «Разрешаю HR связаться со мной» доступна только при отправке с именем. Комбинация «анонимно + contactOk» — 422.
   - Анонимное сообщение автор потом не видит (связать его с автором невозможно). Интерфейс говорит об этом прямо (строка в форме).
   - Проверено: в `main.py` нет middleware логирования запросов. Uvicorn (CMD в `backend/Dockerfile` без `--no-access-log`) пишет в docker-логи адрес источника запроса (за прокси это может быть адрес Caddy, а не клиента), метод, путь и код ответа, но не `user_id` и не тело запроса. В `deploy/Caddyfile.snippet` директивы `log` нет; боевой `/etc/caddy/Caddyfile` целиком не проверялся (`Q-FB1`). Отключение access-лога — `Q-FB1`, в этой задаче не делается.
4. **Антиспам без хранения автора.** Счётчик в памяти процесса по образцу `_failed_attempts` в `core/routes_auth.py`:
   - ключ — `hmac.new(_SALT, str(user_id).encode(), "sha256").hexdigest()`, где `_SALT = secrets.token_bytes(32)` создаётся при импорте модуля. Соль нигде не хранится и не логируется, при рестарте меняется;
   - значение — список `time.monotonic()` отправок; скользящее окно 24 часа (`WINDOW_SECONDS = 86400`); лимит **10 отправок в сутки** (`DAILY_LIMIT = 10`) на пользователя, анонимные и именные вместе. Превышение — 429 с текстом `MSG_TOO_MANY`. Проверка и резерв слота — атомарно под одним `_lock` до `INSERT` (иначе параллельные запросы одного пользователя проскочат лимит); если отправка затем не удалась (исключение до `commit`), слот снимается;
   - `threading.Lock`, просроченные отметки чистятся при каждом обращении; функция `reset_limits()` для тестов (вызов добавить в фикстуру `clean` в `tests/conftest.py`);
   - в БД и в журнал ничего не пишется. Uvicorn работает в одном процессе (CMD без `--workers`), так что счётчик общий. Рестарт обнуляет лимит, это допустимо. При переходе на несколько воркеров лимит станет «на воркер» (строка `TODO(Q-FB4)` у константы).
   - Почему не БД: подсчёт анонимных в БД требует хранить хоть какой-то след автора (даже хеш с постоянной солью позволяет перебором по `users.id` восстановить автора). Хеш с солью, которая живёт только в памяти, такого не позволяет.
5. **Типы:** `thanks` (Благодарность), `idea` (Предложение), `complaint` (Жалоба), `other` (Другое). Только для `thanks` можно выбрать **адресата** — активного сотрудника (необязательно), себя выбрать нельзя. Для остальных типов `recipientId` — 422. Адресат **ничего не видит и не получает уведомления**: благодарность видят только читатели. Это задел под «спасибо» и рейтинг на личной странице (`Q-FB5`). Анонимная благодарность с адресатом разрешена.
6. **Разбор у читателей:** статусы `new` (Новое) → `in_progress` (В работе) → `closed` (Закрыто); переходы любые, в том числе обратно. Внутренний комментарий читателя `note` (до 2000 символов) тоже **шифруется**, автору не показывается. Гонки не закрываем, последняя запись побеждает (`Q-FB6`). Удаления и срока хранения нет (`Q-FB7`).
7. **Автор с именем** видит свои сообщения на вкладке профиля «Моя обратная связь»: тип, текст, адресат, дата и статус. Комментария читателя и того, кто разбирал, автор не видит. Автор не может ни редактировать, ни удалять сообщения. Уведомлений автору о смене статуса нет (`Q-FB8`).
8. **Уведомление** читателям: `notify(session, reader_ids, "feedback.new", "Новое сообщение обратной связи", "", "/modules/feedback")`. Текст, тип, автор и адресат в уведомление **не** попадают. `reader_ids` — активные пользователи с `responsible` на feedback (личное право или группа) плюс активные admin; запрос живёт в `modules/feedback/service.py`.
9. **Бейдж** у пункта меню — число сообщений `new` (только читателю, остальным 0).
10. **Интерфейс.**
    - Главная: запись в `HOME_WIDGETS` **без `slot`**. Это карточка «Обратная связь» в правой колонке с короткой подписью и кнопкой «Написать», которая открывает модалку. Так ядро не меняется. Следствие: у уже сохранённой настройки «Виджеты главной» карточка встаёт в конец и включена, редактор новостей может её передвинуть или выключить. Кнопка в шапке приветствия потребовала бы правки `HubPage` (`Q-FB9`).
    - Меню: пункт «Обратная связь» (`hidden: (me) => !isFeedbackReader(me)`) — только читателям, как «Редактор новостей». Остальным `/modules/feedback` — «Не найдено».
    - Профиль: вкладка «Моя обратная связь» (`PROFILE_SECTIONS`, id `feedback`).
    - Текст сообщений выводится как обычный текст (React экранирует), **без** `dangerouslySetInnerHTML`. Переносы строк сохраняются CSS (`white-space: pre-wrap`).
11. **Журнал** (`module_id='feedback'`): `feedback.create` (только именные: `id`, `kind`), `feedback.update` (`id`, `status` — новое значение, если менялось, `fields` — имена изменённых полей). Текстов, комментариев, имён и `anonymous` в `details` нет. HR-журнал (`hr/audit_view.py`) показывает только `hr.*`/`team.*`/часть `core.*`, `feedback.*` туда не попадают, менять его не нужно.

## Номера миграций и файлов
Последняя ревизия ветки — `0017` (`0017_onboarding.py`). Проверено: `0018` нет ни в одной ветке.

| Ревизия | `down_revision` | SQL | Отметка версии |
|---|---|---|---|
| `backend/alembic/versions/0018_feedback.py` | `"0017"` | `db/18_feedback.sql` | `deploy/stamp_alembic_0018.sql` (`0017 → 0018`) |

- Тело ревизии — по образцу `0016_holidays.py` (`SQL_FILES = ["18_feedback.sql"]`, `_sql_dir()` с `HUB_SQL_DIR`). Докстринг: «Обратная связь сотрудников (таблица feedback_messages). Выполняет db/18_feedback.sql. В боевой базе скрипт и отметка версии выполняются вручную под doadmin (db/18_feedback.sql, затем deploy/stamp_alembic_0018.sql) до слияния кода в main.» Downgrade: `op.execute("DROP TABLE IF EXISTS trendsetter_hub.feedback_messages")`.
- Stamp — как `deploy/stamp_alembic_0017.sql`: две строки комментария + `UPDATE trendsetter_hub.alembic_version SET version_num = '0018' WHERE version_num = '0017';`.
- SQL — в корне `db/`, как у `16_holidays.sql` и `17_onboarding.sql`.
- Перед стартом: `ls backend/alembic/versions` — последней должна быть `0017_onboarding.py`. Если появилась другая `0018`, взять следующий свободный номер и согласованно поменять всё: имя и `revision`, `db/NN_*.sql`, `SQL_FILES`, «ШАГ NN», stamp, ожидания в `test_database.py`, раздел `db/README.md`, этот файл. Голова одна, merge-ревизий нет.

## Данные (`db/18_feedback.sql`)
Шапка: «-- ШАГ 18. Обратная связь сотрудников (модуль feedback, ревизия Alembic 0018).» / «-- Выполнять под doadmin, подключившись к базе defaultdb ПОСЛЕ 17_onboarding.sql. Скрипт можно запускать повторно.» / «-- Права hub_app — автоматически (ALTER DEFAULT PRIVILEGES из 01_core_hub.sql). Текст и комментарий хранятся только зашифрованными (enc:v1:…). У анонимных сообщений автор не хранится.»
```sql
CREATE TABLE IF NOT EXISTS trendsetter_hub.feedback_messages (
  id            bigserial PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('thanks', 'idea', 'complaint', 'other')),
  body          text NOT NULL CHECK (body LIKE 'enc:v1:%'),
  is_anonymous  boolean NOT NULL,
  author_id     bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  contact_ok    boolean NOT NULL DEFAULT false,
  recipient_id  bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'closed')),
  note          text CHECK (note IS NULL OR note LIKE 'enc:v1:%'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  CONSTRAINT feedback_messages_anonymous_check CHECK (NOT is_anonymous OR (author_id IS NULL AND NOT contact_ok)),
  CONSTRAINT feedback_messages_recipient_check CHECK (kind = 'thanks' OR recipient_id IS NULL)
);
CREATE INDEX IF NOT EXISTS feedback_messages_status_idx ON trendsetter_hub.feedback_messages (status, id DESC);
CREATE INDEX IF NOT EXISTS feedback_messages_author_idx ON trendsetter_hub.feedback_messages (author_id) WHERE author_id IS NOT NULL;
```
- Обратное условие («не анонимно → `author_id NOT NULL`») **не ставить**: `ON DELETE SET NULL` при удалении автора его нарушит.
- Длина текста (`body` до 3000, `note` до 2000 символов) проверяется по открытому тексту в Pydantic. В БД длину шифротекста не ограничиваем.
- `updated_by` пишется только действиями читателя. При создании `NULL`: у анонимных так нельзя записать автора даже по ошибке.

## Бэкенд (`backend/app/modules/feedback/`)
Файлы: `__init__.py` (пустой), `router.py`, `service.py`. Из других модулей ничего не импортируется (в том числе `modules.hr.service`).

### Шифрование (`service.py`)
Локальные `_protect(value: str) -> str` и `_reveal(value: str | None) -> str | None` поверх `app.core.crypto`, по образцу `protect_text`/`reveal_text` из `modules/hr/service.py`. `KeyMissing` → 503 `m.ENCRYPTION_NOT_CONFIGURED`; `DecryptError` → строка в лог **только с именем типа ошибки** (`logging.getLogger("app.feedback.crypto")`) и 500 `m.DECRYPT_FAILED`. Значения без префикса не ожидаются (CHECK), но `reveal` их не ломает. Шифрование выполняется **до** проверки лимита и вставки: без ключа — 503, лимит не расходуется.

### Права (`service.py`)
```python
MODULE_ID = "feedback"
def access_of(session, user) -> str: ...                 # module_rights(...)[MODULE_ID][0]
def can_send(access: str) -> bool: return can_see_data(access)
# TODO(Q-FB3): superuser без явного права не читатель
def is_reader(session, user) -> bool:                    # responsible ИЛИ can_manage_users; module_access НЕ используется
def reader_ids(session) -> list[int]:                    # активные: responsible (user_module_permissions + группы) на feedback, плюс admin
def badge(session, user) -> int:                         # is_reader -> count(status='new'), иначе 0
```
В `router.py` зависимости `sender` (403 `m.FORBIDDEN`, если не `can_send`) и `reader` (403, если не `is_reader`), как `reader`/`editor_user` в `modules/news/router.py`.

### Эндпойнты (`APIRouter(prefix="/modules/feedback", tags=["feedback"])`)
Ключи JSON — camelCase. Время — ISO UTC (`_iso` как в news). Все модели запросов с `ConfigDict(extra="forbid")`.

| Метод, путь | Кто | Тело / параметры | Ответ |
|---|---|---|---|
| `GET /people` | отправитель | — | `[{id, fullName}]` — активные пользователи с `access_level IS NOT NULL AND NOT onboarding`, **кроме себя**, по `full_name`. Нужен для выбора адресата благодарности |
| `POST /messages` | отправитель | `{kind, body, anonymous: bool, contactOk: bool = false, recipientId: int \| null = null}` | анонимно: `{"ok": true}`; с именем: объект как в `/mine` |
| `GET /mine` | отправитель | — | `{items: [{id, kind, body, recipientName, contactOk, status, createdAt}]}` — только `author_id = me`, `id DESC`, не больше 50 |
| `GET /messages` | читатель | `status` ∈ `new\|in_progress\|closed` (обязательно), `kind` (необязательно, из 4 типов), `limit` 1..100 (20), `offset` ≥ 0 | `{items: [...], total, counts: {new, in_progress, closed}}`; элемент: `{id, kind, body, anonymous, authorName, contactOk, recipientName, status, note, createdAt, updatedAt, updatedByName}`; сортировка `id DESC` |
| `PATCH /messages/{id}` | читатель | `{status?, note?}` — хотя бы одно поле (иначе 422); `note`: строка до 2000, пустая или из пробелов → `NULL`; явный `null` → `NULL` | элемент как в `/messages`; нет записи — 404 `m.NOT_FOUND` |

Правила `POST /messages`:
- `body`: `strip`, от 1 до 3000 символов (`StringConstraints`), иначе 422.
- `anonymous and contactOk` → 422 `MSG_CONTACT_ANON` («Связаться можно только с неанонимным автором»).
- `recipientId` при `kind != 'thanks'` → 422 `MSG_RECIPIENT_KIND`. Адресат — не активный, на онбординге, без уровня или сам автор → 422 `MSG_RECIPIENT` («Сотрудник не найден»).
- Порядок: валидация → шифрование (503 без ключа) → проверка и резерв слота в лимитере под `_lock` (429) → `INSERT` → для именных `log_action` → `notify(reader_ids)` → `commit`; при исключении после резерва слот снимается.
- `authorName` в `/messages`: для анонимных `null`; для именных — `users.full_name` по `author_id`, а если автор удалён (`NULL` при `is_anonymous = false`) — `MSG_AUTHOR_DELETED` («Сотрудник удалён»). `recipientName` — аналогично, `null`, если адресата нет.
- Тексты ошибок модуля — константы `MSG_*` в `service.py` (как в news). Общие (`FORBIDDEN`, `NOT_FOUND`, `INVALID`, `ENCRYPTION_NOT_CONFIGURED`, `DECRYPT_FAILED`) — из `core/messages.py`, его не менять.
- Лимитер (`_limits`, `_lock`, `_SALT`, `WINDOW_SECONDS`, `DAILY_LIMIT`, `reset_limits()`) живёт в `service.py`. Для тестов есть возможность подменить «сейчас» (например, `_monotonic()`, который подменяется так же, как `_now()` в news).

### Реестр
`backend/app/core/registry.py`: импорт `from app.modules.feedback import service as feedback_service` и `from app.modules.feedback.router import router as feedback_router`, строка манифеста **в конец** `MODULES`. Больше в ядре ничего не меняется.

## Фронтенд
### Модуль `frontend/src/modules/feedback/`
- `strings.js` — `dept: 'Компания'`, `tool`/`name`/`title: 'Обратная связь'`, `description`, `permissionHint: '«Ответственный» — читает и разбирает обратную связь сотрудников, в том числе анонимную. «Просмотр» и «Запуск» ничего не дают'`, подписи типов и статусов, тексты формы, раздела, профиля, виджета, ошибок (`errors`, как у news/holidays, для mock). В форме **дословно**: «Анонимно: ваше имя нигде не сохраняется — ни HR, ни администратор не узнают автора. Отследить ответ на анонимное сообщение вы не сможете.» Все строки модуля лежат в его `strings.js`, как у других модулей.
- `lib/feedback.js` (без React): `FEEDBACK_KINDS`, `FEEDBACK_STATUSES`, `BODY_LIMIT = 3000`, `NOTE_LIMIT = 2000`; `canSendFeedback(me)` = `canSeeData(me?.module_access?.feedback)`; `isFeedbackReader(me)` = `me?.module_responsible?.feedback === true || me?.can_manage_users === true` (зеркало бэкенда, с `TODO(Q-FB3)`); `buildPayload(form)` — собирает тело POST: при `anonymous` принудительно `contactOk: false`, при `kind !== 'thanks'` — `recipientId: null`, `body` обрезан по краям.
- `lib/feedback.test.js` — `node --test`: оба предиката (admin, superuser без права, employee с `module_access.feedback = 'run'` без responsible → не читатель, responsible → читатель, viewer → не отправитель) и `buildPayload`.
- `components/FeedbackModal.jsx` — форма: тип (Segmented/Radio), адресат (Select с поиском по `/people`, только для «Благодарность»), текст (TextArea, `maxLength` и счётчик), переключатель «С моим именем / Анонимно», галочка «Разрешаю HR связаться со мной» (при «Анонимно» скрыта и сброшена), предупреждение об анонимности. После успеха — `message.success` (для анонимного: «Отправлено анонимно»), модалка закрывается. Ошибки 422/429/503 показываются текстом `detail`.
- `components/HomeFeedbackCard.jsx` — карточка правой колонки главной: заголовок, одна строка подписи, кнопка «Написать» → `FeedbackModal`.
- `FeedbackAdminSection.jsx` — страница читателя (`/modules/feedback`): вкладки по статусам со счётчиками из `counts`, фильтр по типу, список с пагинацией. В карточке сообщения: тип, дата, «Аноним» или имя автора, отметка «Можно связаться», адресат, текст. Действия: смена статуса, поле внутреннего комментария, кнопка «Сохранить» → `PATCH`, затем список перечитывается.
- `MyFeedbackSection.jsx` — вкладка профиля: список своих сообщений (тип, адресат, дата, текст, тег статуса), кнопка «Написать» (та же модалка, после отправки `reload()`), пустое состояние со строкой «Анонимные сообщения здесь не показываются».
- `feedback.css` — стили модуля (при необходимости).

### Реестр (`frontend/src/modules/registry.js`) — только **дописать** строки
- `MODULES` (в конец): `{ id: 'feedback', status: 'mvp', hidden: (me) => !isFeedbackReader(me), forAll: true, wide: true, strings: feedbackStrings, Component: lazy(() => import('./feedback/FeedbackAdminSection.jsx')) }`.
- `PROFILE_SECTIONS` (в конец): `{ id: 'feedback', label: feedbackStrings.profile.title, load: ownData((api) => api.get('/modules/feedback/mine')), visible: (me, data) => canSendFeedback(me) && data != null, Component: lazy(() => import('./feedback/MyFeedbackSection.jsx')) }`.
- `HOME_WIDGETS` (в конец, без `slot`): `{ id: 'feedback', label: feedbackStrings.home.widgetLabel, visible: canSendFeedback, Component: lazy(() => import('./feedback/components/HomeFeedbackCard.jsx')) }`.

### Mock (`VITE_DEMO_MODE`)
- `frontend/src/core/api/mock/feedback.js` — `createFeedbackHandlers({ userFromToken, accessTo, isReader, errors, now })`: тот же контракт, коды и правила, что у бэкенда (лимит, 422, 403). **У анонимных записей автор не хранится** ни в записи, ни в замыкании, ни в mock-журнале. Текст хранится открыто, это демо. 2–3 демо-сообщения: одно анонимное, одна благодарность с адресатом.
- `frontend/src/core/api/mock/feedback.test.js` — анонимная запись не содержит id/имени автора (`JSON.stringify` хранилища), employee получает 403 на `/messages`, при «анонимно + contactOk» — 422, `/mine` не возвращает анонимные.
- `handlers.js` — подключение по образцу `holidays` (`isReader: (u) => isModuleResponsible(u, groupPermissionsOf(u, 'feedback')) || canManageUsers(u)`, `errors: getModule('feedback').strings.errors`), `...feedback.handlers` дописать в конец; бейдж `new` — по образцу `news.moduleBadges`. Уведомления в mock — только если `notifications.js` уже даёт API для добавления, иначе не делать.
- `data.js` — пользователю 13 (HR) в `userModulePermissions` добавить `feedback: 'responsible'`.

## Тесты
### Бэкенд `backend/tests/test_feedback.py`
Фикстура ролей — как в `test_holidays.py`: `admin`, `sup` (superuser без права), `emp`, `viewer`, `reader` (employee с `responsible` на feedback), `hr` (employee с `responsible` только на `hr`), `viewrun` (employee с личным `run` на feedback).
1. **Анонимность (обязательные):**
   - анонимный POST от `emp`: в `feedback_messages` `author_id IS NULL`, `is_anonymous`, `contact_ok = false`, `updated_by IS NULL`; **число строк `audit_log` до и после одинаковое**; ни одна строка `audit_log` не содержит почту или ФИО `emp` в `details::text`; ответ ровно `{"ok": true}`;
   - сырая строка таблицы (`SELECT row_to_json(f)::text`) не содержит почту и ФИО автора, а `author_id`/`updated_by` — `NULL`;
   - `GET /mine` у `emp` после анонимной отправки не содержит этого сообщения;
   - уведомления: у каждого читателя (admin, reader) ровно одно новое `feedback.new` с пустым `body`, у `emp`/`sup`/`hr` — ни одного. Если анонимно отправил **сам `reader`**, уведомление есть и у него;
   - анонимно + `contactOk: true` → 422, в таблице ничего не появилось;
   - `caplog` (уровень DEBUG) при анонимном POST: ни в одном сообщении нет почты и ФИО автора (уникальные значения, например `anon-author@example.com` и «Анонимов Тест Уникальный»; id не проверять подстрокой — после `RESTART IDENTITY` id однозначные и дадут ложные срабатывания).
2. **Шифрование:** сырые `body` и `note` начинаются с `enc:v1:` и не содержат исходной фразы; `GET /messages` у читателя возвращает исходный текст; прямой `INSERT` открытого текста под hub_app падает с нарушением `CHECK`; без ключа (подмена `HUB_PII_KEY` пустым значением — по образцу HR-тестов) POST → 503 и в таблице пусто.
3. **Права:** `GET /messages` и `PATCH /messages/{id}`: `emp`, `sup`, `hr`, `viewrun` → 403; `reader` и `admin` → 200. `POST /messages`, `/people`, `/mine`: `viewer` → 403. Без токена → 401. Пользователь на онбординге → 403 с `code = onboarding_required`. `/core/me`: у `reader` и `admin` `module_badges.feedback` = числу `new`, у `sup` и `emp` бейджа нет.
4. **Разбор:** `PATCH` статуса и комментария; `note` из пробелов → `NULL`; пустой `PATCH` → 422; несуществующий id → 404; запись `feedback.update` в журнале содержит только `id`, `status`, `fields`, без текста комментария.
5. **Валидация:** пустой и слишком длинный `body` → 422; неизвестный `kind` → 422; `recipientId` у `idea` → 422; адресат — сам автор, неактивный или несуществующий → 422; лишний ключ → 422.
6. **Именная отправка:** `author_id` = автор, есть `feedback.create` с `user_id` автора и `details` = `{id, kind}`; `/mine` возвращает сообщение со статусом и без `note`; `/messages` у читателя показывает `authorName` и `contactOk`.
7. **Лимит:** 10 отправок проходят, 11-я → 429 (смесь анонимных и именных); после сдвига подменённого времени на 24 ч + 1 с снова проходит; у другого пользователя лимит свой; без ключа (503) лимит не расходуется.
8. **`/people`:** нет себя, неактивных и онбординг-учёток.

### `backend/tests/test_database.py`
- `test_app_role_can_use_feedback_messages` — `INSERT`/`UPDATE`/`SELECT` под hub_app со значением `'enc:v1:x'`; нарушение `CHECK` анонимности (`is_anonymous = true` вместе с `author_id`) → `IntegrityError`.
- `test_feedback_script_is_rerunnable` — двойной прогон `db/18_feedback.sql`, ограничения и индексы на месте.
- `test_feedback_downgrade` — `alembic downgrade 0017` удаляет таблицу, затем `upgrade head` (по образцу downgrade-теста онбординга).
- **Все** ожидания версии `("0017",)` после `upgrade head` заменить на `("0018",)`: `test_onboarding_downgrade_disables_unleveled_users` (финальная проверка), `test_alembic_version_in_hub_schema`, `test_news_moderation_downgrade_keeps_pending_as_draft` и любые другие найденные `grep '"0017"'`. Ожидания промежуточных версий внутри downgrade-тестов (`"0016"`, `"0013"`) не трогать.

### `backend/tests/conftest.py`
- В фикстуре `clean` вызвать `reset_limits()` из `app.modules.feedback.service` рядом с `reset_password_attempts()`. Таблица `feedback_messages` должна очищаться каскадом от `TRUNCATE users … CASCADE` (FK). Проверить, что это так, иначе добавить её в `TRUNCATE`.

### Фронтенд
`npm test` (новые `lib/feedback.test.js`, `mock/feedback.test.js` и все существующие), `npm run lint`, `npm run build` — зелёные.

## Не трогать
- Ядро бэкенда, кроме двух импортов и одной строки в `core/registry.py`: `main.py`, `deps.py`, `access.py`, `audit.py`, `notifications.py`, `crypto.py`, `messages.py`, `routes_*.py`.
- Ядро фронта: `HubPage.jsx`, `AppLayout.jsx`, `ProfilePage.jsx`, `asideWidgets.js`, `widgetConfig.js`, `access.js`, `core/strings.js`, `core/admin/*`, `core/auth/*`.
- Модули `hr`, `news`, `team`, `holidays` и другие (в том числе `hr/audit_view.py`).
- `backend/Dockerfile`, `deploy/docker-compose.prod.yml`, Caddy (см. `Q-FB1`).
- Существующие миграции `0001–0017` и SQL `01–17`; `vite.config.js`.
- Новые библиотеки (бэкенд и фронт), Redis и прочее.

## План
1. **PR 1 — бэкенд и БД** (ветка `feedback` поверх `onboarding`).
   1. `db/18_feedback.sql`, `0018_feedback.py`, `deploy/stamp_alembic_0018.sql`, раздел `db/README.md` → проверка: `alembic upgrade head` на чистой БД, двойной прогон SQL.
   2. `modules/feedback/service.py` и `router.py`, строка в `core/registry.py` → проверка: приложение стартует, `/core/me` отдаёт `module_access.feedback`.
   3. `tests/test_feedback.py`, правки `test_database.py`, `conftest.py` → проверка: весь `pytest` зелёный.
2. **PR 2 — фронт** (та же ветка, после PR 1). **Начинать только после того, как фронт онбординга закоммичен в `onboarding`, а ветка `feedback` обновлена поверх него**: `registry.js`, `mock/handlers.js`, `mock/data.js` правит и агент онбординга. Строки только дописываются в конец, существующие не переставляются.
   1. `modules/feedback/strings.js`, `lib/feedback.js` и тест → `npm test`.
   2. Модалка, карточка главной, раздел читателя, вкладка профиля, строки в `registry.js` → ручная проверка в демо-режиме (см. критерии).
   3. `mock/feedback.js` и тест, подключение в `handlers.js`, право в `data.js` → `npm test`, `npm run lint`, `npm run build`.
3. **Выкат** (после ревью и по команде пользователя): под doadmin `db/18_feedback.sql` (после `17_onboarding.sql`) → `deploy/stamp_alembic_0018.sql` → merge в `main`. Без SQL `/modules/feedback/*` и `/core/me` (бейдж) отвечают 500. Затем администратор в «Особых правах» выдаёт право «Ответственный» на модуле «Обратная связь» сотруднику HR (кому именно — `Q-FB10`). Проверить, что на сервере задан `HUB_PII_KEY` (он уже нужен HR), иначе отправка вернёт 503.

`db/README.md`, раздел «Обратная связь (ревизия 0018)»: таблица и смысл столбцов; у анонимных автор не хранится нигде; текст и комментарий только зашифрованы, `CHECK` отвергает открытый текст; шаги выката 1–3 как выше; откат (`alembic downgrade 0017`): таблица и **все сообщения удаляются безвозвратно**.

## ТЗ для исполнителя
- Работай строго по разделам «Решения», «Данные», «Бэкенд», «Фронтенд», «Тесты» этого файла. Список файлов ниже исчерпывающий: всё, чего в нём нет, не трогать. Если нужно изменить что-то ещё — остановись и верни открытый вопрос.
- **PR 1, файлы:** `db/18_feedback.sql`, `backend/alembic/versions/0018_feedback.py`, `deploy/stamp_alembic_0018.sql`, `db/README.md` (новый раздел после «Онбординг», остальное не трогать), `backend/app/modules/feedback/__init__.py`, `router.py`, `service.py`, `backend/app/core/registry.py` (два импорта и одна строка), `backend/tests/test_feedback.py`, `backend/tests/test_database.py`, `backend/tests/conftest.py` (импорт и одна строка `reset_limits()`; таблицу в `TRUNCATE` — только если каскада не хватает).
- **PR 2, файлы:** `frontend/src/modules/feedback/**` (новые), `frontend/src/modules/registry.js` (импорты и три записи в конец списков), `frontend/src/core/api/mock/feedback.js` и `feedback.test.js` (новые), `frontend/src/core/api/mock/handlers.js` (подключение), `frontend/src/core/api/mock/data.js` (одно право).
- Пример анонимной отправки:
  ```
  POST /modules/feedback/messages  {"kind": "complaint", "body": "…", "anonymous": true}
  → 200 {"ok": true}
  ```
  Пример отправки с именем:
  ```
  POST /modules/feedback/messages  {"kind": "thanks", "body": "Спасибо за помощь с отчётом", "anonymous": false, "contactOk": true, "recipientId": 7}
  → 200 {"id": 12, "kind": "thanks", "body": "Спасибо за помощь с отчётом", "recipientName": "…", "contactOk": true, "status": "new", "createdAt": "…"}
  ```
- В обработчике анонимной отправки **запрещено** передавать `user.id` в `log_action`, в `notify` (в том числе исключать автора из списка), в `logging`, в `updated_by`, в ответ и в любые столбцы. Единственное допустимое использование `user.id` — ключ лимитера через HMAC с солью из памяти.
- Не логировать тексты сообщений, комментарии, имена и id авторов ни на каком уровне, включая `debug`.
- Коммиты — по одному или несколько на PR, на русском, с подписью из системного напоминания. **Не пушить.**
- Неясности (`Q-FBn`) не решать молча: ставить `TODO(Q-FBn)` в коде и указывать пункт в отчёте.

## Критерии приёмки для ревьюера
- **[PR 1] Анонимность:** в дифе нет ни одного пути, по которому `user.id` анонимного автора попадает в БД (`feedback_messages`, `audit_log`, `notifications`), в логгер или в ответ. Тесты из п. 1 раздела «Тесты» есть и проходят, в том числе «число строк `audit_log` не изменилось» и «автор-читатель тоже получил уведомление».
- **[PR 1] Шифрование:** `body` и `note` пишутся только через `_protect` (поверх `app.core.crypto`), импорта из `modules.hr` нет. В SQL есть `CHECK … LIKE 'enc:v1:%'` для обоих полей. Без ключа POST → 503, ничего не записано и лимит не израсходован. При ошибке расшифровки в лог попадает только тип ошибки.
- **[PR 1 + PR 2] Права:** читатель — это `responsible` или admin. superuser без права, HR без права и employee с `view`/`run` получают 403 (тесты есть). На фронте `isFeedbackReader` смотрит на `module_responsible`/`can_manage_users`, а не на `module_access`. viewer получает 403 на отправку, и кнопки у него нет.
- **[PR 1] Миграция:** `0018` с `down_revision = "0017"`, SQL идемпотентен, stamp `0017 → 0018`, downgrade удаляет таблицу. В `test_database.py` все финальные ожидания версии — `0018`. Голова Alembic одна.
- **[PR 1] Лимит:** только в памяти, ключ — HMAC с солью, созданной при импорте; проверка и резерв слота под одним `_lock`. Следов в БД и журнале нет. 11-я отправка за сутки → 429. `reset_limits()` вызывается в `clean`.
- **[PR 1 + PR 2] Ядро не тронуто**, кроме `core/registry.py` (два импорта + одна строка манифеста). На фронте меняются только `modules/registry.js` (дописано в конец), `mock/handlers.js` и `mock/data.js`. Файлов из «Не трогать» в дифе нет.
- **[PR 2] UI (демо-режим):** карточка «Обратная связь» на главной есть у employee/superuser/admin и отсутствует у viewer. В модалке галочка «связаться» скрыта при «Анонимно», адресат — только у «Благодарность», предупреждение об анонимности — дословно как в ТЗ. Пункт меню «Обратная связь» с бейджем `new` видят только читатели, остальным `/modules/feedback` показывает «Не найдено». Вкладка профиля показывает только именные сообщения, без комментария читателя. Текст выводится без `dangerouslySetInnerHTML`.
- **[PR 1] Уведомление** читателям без текста, типа и имени (`body` пустой, ссылка `/modules/feedback`). Адресат благодарности ничего не получает.
- **[PR 1] Журнал:** `feedback.create` только для именных (`id`, `kind`), `feedback.update` (`id`, `status`, `fields`). Текстов и комментариев в `details` нет.
- **[PR 1]** `pytest` зелёный. **[PR 2]** `npm test` (включая `mock/feedback.test.js`: анонимная запись без автора), `npm run lint`, `npm run build` — зелёные. Строки UI модуля лежат в `modules/feedback/strings.js`.

## Открытые вопросы (по умолчанию приняты решения выше; пересматриваются по ответу пользователя)
- **Q-FB1.** Логи uvicorn в docker хранят адрес источника (за прокси — возможно, адрес Caddy), время и путь `/modules/feedback/messages`; боевой `/etc/caddy/Caddyfile` на глобальный `log` не проверялся. У того, у кого есть доступ к серверу, остаётся теоретическая корреляция «IP + время → автор». По умолчанию ничего не меняем. Варианты: `--no-access-log` в CMD Dockerfile (для всего хаба) или фильтр логгера по этому пути. Тот же класс риска — точное время уведомления у читателя, которое можно сопоставить с действиями сотрудника в HR-журнале. Альтернатива — утренний дайджест через `daily_job` вместо мгновенного уведомления.
- **Q-FB2.** Может ли viewer отправлять обратную связь? По умолчанию нет.
- **Q-FB3.** superuser без явного права не читатель (по образцу `Q-N3`).
- **Q-FB4.** Лимит — 10 сообщений в сутки на пользователя, хранится в памяти, сбрасывается при рестарте; при нескольких воркерах станет «на воркер».
- **Q-FB5.** Благодарность адресату (публично, «спасибо» и рейтинг в профиле) — отдельная задача. Сейчас адресат ничего не видит.
- **Q-FB6.** Гонка правок двух читателей не закрыта, последняя запись побеждает.
- **Q-FB7.** Удаление сообщений и срок хранения не предусмотрены.
- **Q-FB8.** Уведомлять ли автора с именем о смене статуса? По умолчанию нет, статус виден в профиле.
- **Q-FB9.** Кнопка сделана карточкой в правой колонке главной, её можно скрыть или передвинуть через «Виджеты главной». Если нужна кнопка в шапке приветствия, придётся править ядро (`HubPage.jsx`).
- **Q-FB10.** Кому, кроме admin, выдать «Ответственного» на обратную связь (конкретные сотрудники HR)? Нужен ли кто-то ещё, например руководитель?
