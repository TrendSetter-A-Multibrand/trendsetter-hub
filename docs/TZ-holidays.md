# ТЗ: производственный календарь РФ и Армении — виджет «Праздники и выходные», модальное окно календаря, раздел редактора

Статус: lead, 2026-10-29. Ветка **`holidays`** (локальная, поверх `news-moderation` @ `50d46a0`: миграции до `0015`, `home_widgets`, флаг `home_editor`, раздел «Редактор новостей»). **Ничего не пушить**, ветку не менять, не ребейзить, `main` не мержить без команды пользователя. Открытые вопросы — префикс `Q-HC*` (`Q-H*` занят главной); в коде — `TODO(Q-HCn)`.

## Задача (пользователь, 2026-10-29)
1. Виджет на главной «Праздники и выходные»: ближайшие нерабочие дни и праздники **отдельно для Армении и РФ** (когда люди отдыхают).
2. Кнопка в виджете открывает модальное окно с **производственным календарём** за год (12 месяцев): праздники, выходные, перенесённые рабочие дни, предпраздничные сокращённые — для РФ и Армении.
3. Аревик (ответственная за новости) сама вручную ведёт календарь в отдельном разделе: страна, год, отметить день или **диапазон дней** как праздник / выходной (перенос) / рабочий (перенос) / сокращённый, с названием. Данные — в БД, **без внешних API**. Кнопки «заполнить стандартные выходные» нет; суббота и воскресенье считаются выходными автоматически.

## Решения

1. **Новый модуль `holidays`, а не расширение `news`.** Причины: правило «новая функция = модуль; ядро не переделывается»; механизмы `for_all`, `hidden: (me) => …`, `HOME_WIDGETS`, «Особые права» и группы уже работают для любого модуля без правок ядра; календарь — будущий источник для HR (учёт праздников в отпусках, `Q-D2`), и ему лучше не зависеть от новостей. Цена — администратор один раз выдаёт Аревик право «Ответственный» на новом модуле (шаг выката).
   - **id `holidays`**, не `calendar`: в очереди задач стоит «Google Календарь (встречи на главной)», имя `calendar` оставляем ему. Таблица — `holidays_days` (приставка модуля). Подпись в меню и в «Особых правах» — «Производственный календарь».
   - Ядро про модуль не знает: одна строка в `MODULES` бэкенда (`core/registry.py`), одна строка в `MODULES` и одна в `HOME_WIDGETS` фронта (`modules/registry.js`). `HubPage.jsx`, `asideWidgets.js`, `widgetConfig.js`, `routes_core.py`, `access.py`, `deps.py` **не меняются**.
2. **Права (зеркало `news`).**
   - Манифест: `ModuleManifest("holidays", "Производственный календарь", "mvp", holidays_router, for_all=True)`; `badge`, `daily_job` нет; `home_editor` **не** ставится (виджеты главной Аревик и так настраивает как редактор новостей).
   - **Читатель** = `can_see_data(access)` (view/run). Все активные сотрудники получают `view` через `for_all`; **viewer** (`structure`) — не читатель: 403 на API, виджет не рендерится и запросов не делает (правило «viewer видит только интерфейс, без данных», как у новостей). Пересмотр — `Q-HC2`.
   - **Редактор** = «Ответственный» (`responsible`) на `holidays` (личное право или группа) **или** `can_manage_users` (admin). superuser без явного права — не редактор (`TODO(Q-HC3)`, по образцу `Q-N3`).
   - Меню: `hidden: (me) => !isHolidaysEditor(me)` — пункт «Производственный календарь» (подпись отдела «Компания») видят только редакторы; остальным `/modules/holidays` → «Не найдено». Читателям календарь доступен через модальное окно из виджета.
3. **В БД — только исключения.** Одна строка = один день одной страны. Суббота и воскресенье без строки — выходной, пн–пт без строки — рабочий день. Четыре вида исключений:

   | `kind` | Смысл | Где допустим | `name` |
   |---|---|---|---|
   | `holiday` | праздничный нерабочий день | любой день (праздник может выпасть на сб/вс) | **обязательно**, 1..100 |
   | `day_off` | дополнительный выходной (перенос выходного на будний день, «каникулы») | любой день | необязательно, ≤ 100 |
   | `workday` | рабочий день (перенос) — суббота/воскресенье, ставшие рабочими | **только сб/вс** | необязательно |
   | `short` | предпраздничный сокращённый **рабочий** день | любой день; на сб/вс означает «рабочая суббота, сокращённая» (так бывает в РФ, напр. 01.11.2025) | необязательно |

   - `holiday` и `day_off` разрешены и на выходных, чтобы диапазон «1–8 января, Новогодние каникулы» сохранялся одним действием.
   - Эффективный тип дня: строка есть → её `kind`; иначе сб/вс → `weekend`; иначе `work`. **Нерабочий** = `holiday`, `day_off`, `weekend`. `workday` и `short` — рабочие.
   - Выходные дни недели — сб и вс для обеих стран (`TODO(Q-HC1)`: шестидневка в части организаций Армении не учитывается).
4. **Массовое добавление — диапазоном.** Запись принимает `start..end` (включительно, не больше 31 дня, можно через границу года), один `kind` и одно `name` на все дни диапазона. Существующие строки в диапазоне **перезаписываются** (upsert). Если хоть один день диапазона нарушает правило вида (`workday` на пн–пт) — 422 **на весь диапазон**, ничего не пишется; дни молча не пропускаются. Удаление — тоже диапазоном («сбросить дни» = вернуть к правилу сб/вс).
5. **Гонки не закрываем:** редактор фактически один; последняя запись побеждает, `expectedUpdatedAt` не нужен (`Q-HC4`).
6. **Расчёт — на фронте, одна чистая функция.** Бэкенд только хранит и отдаёт строки за период. Эффективный тип дня, сетка месяцев и «периоды отдыха» для виджета считаются в `modules/holidays/lib/holidays.js` (без React, тесты `node --test`). Бэкенд этих правил не дублирует, кроме валидации записи (`workday` только на сб/вс).
7. **Периоды отдыха (виджет).** Для страны: идём по дням от «сегодня» (в часовом поясе страны: AM — `Asia/Yerevan`, RU — `Europe/Moscow`) до `сегодня + 365`; собираем максимальные отрезки подряд идущих нерабочих дней; показываем только отрезки, где есть хотя бы один `holiday` или `day_off` (обычные выходные не показываем); первые **3** отрезка. Начало отрезка, начавшегося до сегодня, — сегодня (метка «сейчас»). Название отрезка — уникальные `name` его строк в порядке дат через «, »; если названий нет совсем — подпись вида «Выходные». Число дней — длина отрезка с учётом примыкающих сб/вс. Пример (2026 год): РФ, строки 01–08.01.2026 `holiday` «Новогодние каникулы», 09.01.2026 (пт) `day_off`, 10–11.01.2026 — сб/вс, сегодня 29.12.2025 → «1–11 янв · Новогодние каникулы · 11 дн.» (в тестах дни недели сверять с конкретным годом).
8. **Главная.** Запись в `HOME_WIDGETS` без `slot` → виджет сам попадает в правую колонку (`ASIDE_WIDGETS`) и в «Виджеты главной» редактора новостей; у уже сохранённой настройки `home_widgets` новый виджет встаёт **в конец и включён** (так работает `widgetConfig.resolve`). Миграция данных `home_widgets` не нужна.
9. **Журнал** (`log_action`, `module_id='holidays'`): `holidays.set` — `country, start, end, kind, count`; `holidays.delete` — `country, start, end, count` (только если `count > 0`). **Названий** (`name`) в `details` нет.
10. **Без подсчёта норм** рабочих дней/часов по месяцам (не просили; при необходимости — отдельная задача, `Q-HC5`).

## Номера миграций и файлов
Последняя ревизия ветки — `0015`. Этой задаче принадлежат:

| Ревизия | `down_revision` | SQL | Отметка версии |
|---|---|---|---|
| `backend/alembic/versions/0016_holidays.py` | `"0015"` | `db/16_holidays.sql` | `deploy/stamp_alembic_0016.sql` (`0015 → 0016`) |

- Тело ревизии — по образцу `0015_home_widgets.py` (`SQL_FILES = ["16_holidays.sql"]`, `_sql_dir()` с `HUB_SQL_DIR`, докстринг «Выполняет db/16_holidays.sql. В боевой базе скрипт и отметка версии выполняются вручную под doadmin (db/16_holidays.sql, затем deploy/stamp_alembic_0016.sql) до слияния кода в main.»). Downgrade: `op.execute("DROP TABLE IF EXISTS trendsetter_hub.holidays_days")`.
- Stamp — как `deploy/stamp_alembic_0015.sql`: две строки комментария + `UPDATE trendsetter_hub.alembic_version SET version_num = '0016' WHERE version_num = '0015';`.
- SQL лежит в корне `db/` (`16_holidays.sql`) **по прямой просьбе пользователя**; конвенция для таблиц модуля — `db/modules/<id>/001_*.sql` — здесь осознанно не применяется (одна строка об этом в `db/README.md`).
- Перед стартом: `ls backend/alembic/versions` — последняя должна быть `0015_home_widgets.py`. Если появилась другая `0016` — взять следующий свободный номер и перенумеровать согласованно всё (имя и `revision` ревизии, `db/NN_*.sql` и `SQL_FILES`, шапку «ШАГ NN», stamp, ожидания в `test_database.py`, раздел `db/README.md`, этот файл). Одна голова, без merge-ревизий.
- `0016` занимает эта задача; неотслеживаемый `docs/TZ-onboarding.md` при старте онбординга берёт следующий свободный номер (в этой задаче не правится и **не коммитится**).

## Данные (`db/16_holidays.sql`)
Шапка — как у `15_home_widgets.sql`: «-- ШАГ 16. Производственный календарь РФ и Армении (модуль holidays, ревизия Alembic 0016).» / «-- Выполнять под doadmin, подключившись к базе defaultdb ПОСЛЕ 15_home_widgets.sql. Скрипт можно запускать повторно.» / права hub_app — автоматически (`ALTER DEFAULT PRIVILEGES` из `01_core_hub.sql`); в БД только исключения, сб/вс без строки — выходной.
```sql
CREATE TABLE IF NOT EXISTS trendsetter_hub.holidays_days (
  country    text NOT NULL CHECK (country IN ('RU', 'AM')),
  day        date NOT NULL CHECK (day BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
  kind       text NOT NULL CHECK (kind IN ('holiday', 'day_off', 'workday', 'short')),
  name       text CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 100),
  updated_by bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (country, day),
  CONSTRAINT holidays_days_holiday_name_check CHECK (kind <> 'holiday' OR name IS NOT NULL),
  CONSTRAINT holidays_days_workday_check CHECK (kind <> 'workday' OR extract(isodow FROM day) IN (6, 7))
);
```
- Сидов нет (данные вносит Аревик). Привязки к отделам (`module_departments`) нет — модуль `for_all`. Права модуля — без DDL (особые права и группы работают для любого id из реестра).
- Коды стран — как в HR-досье (`RU`, `AM`).
- **Очистка в тестах:** `conftest.py::clean` делает `TRUNCATE … users … CASCADE`; из-за FK `updated_by → users` PostgreSQL очищает и `holidays_days`. `conftest.py` **не трогать**; если тест покажет, что строки переживают `clean`, — остановиться и вернуть вопрос.

## Бэкенд (`backend/app/modules/holidays/`)
Файлы: `__init__.py` (пустой), `router.py`, `service.py`. Образец стиля — `modules/news` (`access_of`, `can_read`, `is_editor`, зависимости `Reader`/`Editor`, SQL через `text()`, ORM-модель **не** добавлять, `log_action`, `MSG_*`, шапка-докстринг модуля с описанием правил).

### Права
- `service.access_of(session, user)` = `module_rights(...)["holidays"][0]`; `can_read(access)` = `can_see_data(access)`; `is_editor(session, user)` = responsible на `holidays` **или** `can_manage_users` (`TODO(Q-HC3)`).
- `router.reader` — читатель или редактор, иначе 403; `router.editor_user` — редактор, иначе 403. Без токена — 401 (из `get_current_user`).

### Эндпойнты (`APIRouter(prefix="/modules/holidays")`)

| Метод и путь | Кто | Вход | Ответ | Правила |
|---|---|---|---|---|
| `GET /days?start=YYYY-MM-DD&end=YYYY-MM-DD` | Reader | query `start`, `end` (`date`, обязательные) | `{"start", "end", "days": [{"country", "date", "kind", "name"}]}` | обе страны; `ORDER BY country, day`; `end < start` → 422; `end - start > 400` дней → 422; даты вне 2000-01-01..2100-12-31 → 422 |
| `POST /days` | Editor | `{"country", "start", "end", "kind", "name"}` | `{"days": [...]}` — строки диапазона после записи (тот же формат) | см. «Валидация записи»; upsert всех дней диапазона (`INSERT … ON CONFLICT (country, day) DO UPDATE SET kind, name, updated_by, updated_at = now()`) в одной транзакции; журнал `holidays.set` |
| `POST /days/delete` | Editor | `{"country", "start", "end"}` | `{"count": n}` | те же проверки диапазона (≤ 31 дня, порядок, границы); `DELETE … WHERE country = :c AND day BETWEEN :s AND :e`; пустой диапазон → `{"count": 0}`, 200; журнал `holidays.delete` только при `n > 0` |

Пример ответа `GET /days?start=2027-01-01&end=2027-01-31`:
```json
{"start": "2027-01-01", "end": "2027-01-31", "days": [
  {"country": "AM", "date": "2027-01-01", "kind": "holiday", "name": "Новый год"},
  {"country": "RU", "date": "2027-01-01", "kind": "holiday", "name": "Новогодние каникулы"},
  {"country": "RU", "date": "2027-01-11", "kind": "day_off", "name": null}
]}
```

### Валидация записи (Pydantic + `service`)
- Модели тела с `model_config = ConfigDict(extra="forbid")` (лишние ключи → 422). `country: Literal["RU", "AM"]`, `kind: Literal["holiday", "day_off", "workday", "short"]`, `start`/`end: date`, `name: str | None` — `strip`; пустая строка после `strip` → `None`; длина > 100 → 422.
- `end < start` → 422 `MSG_RANGE_ORDER` «Дата окончания раньше даты начала»; дней в диапазоне > 31 → 422 `MSG_RANGE_TOO_LONG` «Не больше 31 дня за один раз»; даты вне 2000..2100 → 422.
- `kind == "holiday"` и `name is None` → 422 `MSG_NAME_REQUIRED` «Укажите название праздника».
- `kind == "workday"` и в диапазоне есть пн–пт → 422 `MSG_WORKDAY_WEEKEND` «Рабочим днём (перенос) можно отметить только субботу или воскресенье» (+ до 5 неподходящих дат `ДД.ММ.ГГГГ`). Ничего не записывается.
- `GET`: `end - start > 400` → 422 `MSG_PERIOD_TOO_LONG` «Период не больше 400 дней».
- Тексты ошибок — константы `MSG_*` в `service.py`, по-русски, отдаются в `detail` как у `news` (`fail(...)`). Время записи — `now()` БД (часов для тестов не нужно: правил «от сегодня» на бэкенде нет).

### Реестр
`backend/app/core/registry.py`: импорт `from app.modules.holidays.router import router as holidays_router` и **последней** строкой `MODULES`: `ModuleManifest("holidays", "Производственный календарь", "mvp", holidays_router, for_all=True)`. Больше в ядре бэкенда ничего.

## Фронтенд

### Модуль `frontend/src/modules/holidays/`
- **`strings.js`** — все строки модуля: `dept` «Компания», `tool` / `title` / `name` «Производственный календарь», `description`, `permissionHint` «„Ответственный“ — ведёт производственный календарь РФ и Армении (раздел „Производственный календарь“ в меню)»; `countries: { AM: 'Армения', RU: 'Россия' }`; `kinds: { holiday: 'Праздник', day_off: 'Выходной (перенос)', workday: 'Рабочий день (перенос)', short: 'Сокращённый день', weekend: 'Выходной', work: 'Рабочий день' }`; `months`, `weekdays` (пн — первый); `home.*` (`widgetLabel`/`title` «Праздники и выходные», `empty` «Ближайших праздников в календаре нет», `now` «сейчас», `days(n)` со склонением «день/дня/дней», `openCalendar` «Производственный календарь», `loadError`); `calendar.*` (`legend`, `prevYear`/`nextYear` для `aria-label`, `listTitle` «Праздники и переносы», `empty`); `admin.*`; `errors.*` (для mock — те же тексты, что `MSG_*`). В JSX — без литералов.
- **`lib/holidays.js`** — чистые функции, без React; дата — строка `YYYY-MM-DD`; вспомогательные — из `core/dates.js` (`parseIso`, `addDays`, `formatDate`); `modules/team/**` не импортировать:
  - `COUNTRIES = [{ id: 'AM', timezone: 'Asia/Yerevan' }, { id: 'RU', timezone: 'Europe/Moscow' }]` (порядок как у часов на главной; первая — по умолчанию в модалке и разделе), `KINDS = ['holiday', 'day_off', 'workday', 'short']`;
  - `canReadHolidays(me)` = `canSeeData(me?.module_access?.holidays)`; `isHolidaysEditor(me)` = `me?.module_responsible?.holidays === true || me?.can_manage_users === true` (зеркала бэкенда);
  - `isWeekend(iso)` (сб/вс по UTC-дате; `TODO(Q-HC1)`), `dayType(iso, row)` → `holiday|day_off|workday|short|weekend|work`, `isRest(type)`;
  - `indexDays(days)` → `{ AM: Map<iso,row>, RU: Map<iso,row> }`;
  - `todayIn(timezone, now = new Date())` → `YYYY-MM-DD` в зоне страны (через `Intl.DateTimeFormat('en-CA', { timeZone })`);
  - `restPeriods(rowsByDate, today, { horizon = 365, limit = 3 } = {})` → `[{ start, end, days, names, now }]` по решению 7;
  - `monthGrid(year, month)` → недели (пн — первый) из ячеек `{ iso }` или `null` для пустых;
  - `groupRanges(rows)` → подряд идущие дни одной страны с одинаковыми `kind` и `name` склеиваются в `{ country, start, end, kind, name }`;
  - `validateRange({ start, end, kind, name })` → текст первой ошибки или `null` — зеркало серверной проверки (порядок, ≤ 31 дня, `name` для `holiday`, `workday` только сб/вс).
- **`components/YearCalendar.jsx`** — сетка 12 месяцев одной страны за год, собственная разметка по `monthGrid` (**не** antd `Calendar`). Ячейка: число + класс по `dayType` (`hc-holiday`, `hc-dayoff`, `hc-weekend`, `hc-workday`, `hc-short`, `hc-today`); `title` ячейки — «1 января — Праздник: Новый год». Легенда под сеткой (5 видов + «Рабочий день»). Проп `onDayClick(iso)` необязательный: есть — ячейки `<button>` с `aria-label`, нет — `<div>`. Цвета — из CSS-переменных темы (светлая и тёмная); `workday` и `short` дополнительно отмечены маркером (подчёркивание/точка), чтобы различаться не только цветом.
- **`components/CalendarModal.jsx`** — `Modal` (`width={960}`, `centered`, без футера): заголовок «Производственный календарь», `Segmented` страны, переключатель года (стрелки + год; начальный — текущий), `YearCalendar` выбранной страны, под ним список «Праздники и переносы» года (`groupRanges`, строка вида «01.01–08.01 · Праздник · Новогодние каникулы»). Данные — `GET /modules/holidays/days?start=Y-01-01&end=Y-12-31` (обе страны одним запросом; смена страны запроса не делает; смена года — новый запрос). Ошибка → `Alert`. Узкий экран — месяцы переносятся (`grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))`), без горизонтальной прокрутки страницы.
- **`components/HomeHolidays.jsx`** — виджет (`section.home-card`, как `team/components/HomeLeave.jsx`): заголовок «Праздники и выходные»; два блока — «Армения», «Россия» (порядок `COUNTRIES`); в каждом до 3 строк `restPeriods`: даты («31 дек – 11 янв» или одна дата), названия, «N дн.», у текущего — метка «сейчас»; пусто — `home.empty`. Внизу кнопка `type="link"` «Производственный календарь» → `CalendarModal`. Данные — **один** запрос `GET /days` со `start` = меньшая из дат `todayIn` двух стран и `end` = `start + 366`; пока грузится — `Spin size="small"`; ошибка — `Alert` (как `HomeLeave`).
- **`components/DaysModal.jsx`** — форма редактора: страна (`Segmented`, предзаполнена), даты `DatePicker.RangePicker` (одна дата = одинаковые начало и конец; работа с `dayjs` — **как в `hr/components/LeavesTab.jsx` / `hr/plan/PlanSection.jsx`**, новых зависимостей нет), вид (`Select` из `KINDS` с подписями), название (`Input`, `maxLength={100}`; подсказка «обязательно для праздника»), подсказка правил («Суббота и воскресенье — выходные автоматически; „Рабочий день (перенос)“ — только сб/вс»). Футер: «Сохранить» (`POST /days`), «Сбросить дни» (`Popconfirm` → `POST /days/delete`; видна, если в выбранном диапазоне есть строки), «Отмена». Перед отправкой — `validateRange`; 422 сервера → `message.error(e.message)`, окно остаётся открытым; успех → `message.success`, закрыть, перечитать год.
- **`HolidaysAdminSection.jsx`** — страница `/modules/holidays` (получает `{ module, access }` от `ModulePage`): `h1` «Производственный календарь»; панель: `Segmented` страны, переключатель года, кнопка «Отметить дни» (`DaysModal` с пустыми датами, страна — выбранная); `YearCalendar` с `onDayClick` → `DaysModal` с `start = end = iso`, `kind`/`name` из существующей строки (строки нет: сб/вс → `workday`, пн–пт → `holiday`); ниже список `groupRanges` выбранной страны за год с «Изменить» (`DaysModal` с диапазоном) и «Удалить» (`Popconfirm` → `POST /days/delete`). Данные — тот же `GET` за год; `YearCalendar` и логика — общие с модалкой, без копий.
- **`holidays.css`** — стили модуля с приставкой `hc-`; `core/styles.css` не трогать.

### Реестр (`frontend/src/modules/registry.js`)
- Импорт `holidaysStrings` и `{ canReadHolidays, isHolidaysEditor }`.
- `MODULES` — **последней** строкой (после `news`; номера прочих пунктов не сдвигаются): `{ id: 'holidays', status: 'mvp', hidden: (me) => !isHolidaysEditor(me), forAll: true, wide: true, strings: holidaysStrings, Component: lazy(() => import('./holidays/HolidaysAdminSection.jsx')) }`.
- `HOME_WIDGETS` — после `leave` (до записей со `slot`): `{ id: 'holidays', label: holidaysStrings.home.widgetLabel, visible: canReadHolidays, Component: lazy(() => import('./holidays/components/HomeHolidays.jsx')) }`.
- `homeEditor` у `holidays` **не** ставить.

### Mock (`VITE_DEMO_MODE`)
- Новый `frontend/src/core/api/mock/holidays.js`: `createHolidaysHandlers({ userFromToken, accessTo, isEditor, errors, now = () => new Date() })` → `{ handlers }` с `GET /modules/holidays/days`, `POST /modules/holidays/days`, `POST /modules/holidays/days/delete` — тот же контракт, коды (401/403/422) и правила валидации, upsert и удаление диапазоном. Журнал не ведётся. `frontend/src/core/**` не импортирует `modules/holidays/**` (прецедент `mock/news.js` с копией `COLORS`): mock держит свою короткую проверку записи (порядок, ≤ 31 дня, `name` для `holiday`, `workday` только сб/вс, период ≤ 400) с комментарием «зеркало бэкенда и modules/holidays/lib/holidays.js»; тексты ошибок — из `errors`, переданных `handlers.js` через реестр.
- Демо-данные — относительно года `now()` (текущий и следующий), с комментарием «**вымышленные/несверенные, только для демонстрации**»: у RU — диапазон 01–08.01 `holiday` «Новогодние каникулы», один `day_off` в будний день января, 23.02, 08.03, 01.05, 09.05, 12.06, 04.11 (`holiday`), одна `workday`-суббота и один `short` накануне праздника; у AM — 01–02.01 «Новый год», 06.01 «Рождество», 08.03, 24.04, 09.05, 28.05, 05.07, 21.09, 31.12. Так в демо виджет не пуст в любой день года.
- `mock/handlers.js`: создать `holidays = createHolidaysHandlers({ userFromToken, accessTo, isEditor: (u) => isModuleResponsible(u, groupPermissionsOf(u, 'holidays')) || canManageUsers(u), errors: getModule('holidays').strings.errors })` и добавить `...holidays.handlers` в `handlers`.
- `mock/data.js`: в `userModulePermissions` пользователю 9 («Сотрудник HR», демо-редактор новостей = роль Аревик) добавить `holidays: 'responsible'`. Больше в `data.js` ничего (в `moduleDepartments` модуль не добавляется — `forAll`).

## Тесты
**Бэкенд — новый `backend/tests/test_holidays.py`** (фикстуры `client`, `db`, `make_user`, `login` из `conftest.py`; личное право — `UserModulePermission(user_id=…, module_id='holidays', permission='responsible')`, как в `test_home.py`):
1. Права: без токена — 401; viewer — 403 на `GET`; employee без отдела — 200 на `GET`, 403 на `POST /days` и `/days/delete`; superuser без права — 403 на запись; responsible на `holidays` — 200; admin — 200; responsible только на `news` — 403 на запись. `/core/me` у responsible: `module_responsible["holidays"] is True`.
2. Диапазон: `RU 2027-01-01..2027-01-08 holiday «Новогодние каникулы»` → 8 строк (включая сб/вс), `GET` их отдаёт; повторная запись части диапазона другим `kind` перезаписывает только эту часть; `day_off` на сб — 200; `short` на сб — 200.
3. Валидация (422, **ни одной строки не записано**): `workday` на диапазоне, где есть пн; `holiday` без `name` и с `name` из пробелов; `name` 101 символ; 32 дня; `end < start`; 1999 год; `country: "US"`; `kind: "weekend"`; лишний ключ. `day_off` с `name: "  "` → 200, `name` = `null`.
4. `GET`: границы включительно; сортировка `country, day`; строки обеих стран; период 401 день → 422; `end < start` → 422.
5. Удаление: `count` = число удалённых; повтор — `count: 0`, 200; после удаления `GET` их не отдаёт; соседние дни вне диапазона и другая страна не тронуты.
6. Журнал: `holidays.set` (`module_id='holidays'`, ключи `details` ровно `country, start, end, kind, count`) и `holidays.delete` (нет записи при `count = 0`); в `json.dumps(details)` нет названия праздника.

**`backend/tests/test_me.py`:** в ожидаемом словаре `module_access` (строка 16, сейчас 8 модулей) добавить `"holidays"`.

**`backend/tests/test_database.py`:** ожидаемая версия `"0016"` **в обоих местах** (`test_alembic_version_in_hub_schema` и конец `test_news_moderation_downgrade_keeps_pending_as_draft`); повторный прогон `db/16_holidays.sql` не падает; hub_app может `SELECT/INSERT/UPDATE/DELETE` в `holidays_days` (по образцу `test_app_role_can_use_home_widgets`); вставка `workday` на понедельник и `holiday` без `name` падают на ограничениях БД.

**Фронтенд (`npm test`):**
- `modules/holidays/lib/holidays.test.js`: `isWeekend`; `dayType` для всех видов и без строки; `restPeriods` — новогодний отрезок склеивается с примыкающими сб/вс и `day_off`; рабочая суббота (`workday`/`short`) разрывает отрезок; обычные выходные без праздника не выводятся; отрезок через границу года; «сегодня» внутри отрезка → начало = сегодня, `now: true`; `limit` и `horizon`; пустые данные → `[]`; `monthGrid` — пн первый, февраль високосного года, месяц, начинающийся в вс; `todayIn` около полуночи (`2026-12-31T20:30:00Z` → RU `2026-12-31`, AM `2027-01-01`; `2026-12-31T21:30:00Z` → обе `2027-01-01`); `groupRanges`; `validateRange` — те же случаи, что серверная валидация.
- `core/api/mock/holidays.test.js`: права (401; 403 viewer; 403 запись не-редактору), 422 по каждому правилу без частичной записи, upsert, удаление диапазоном и `count`, период > 400 дней → 422.

## Файлы
**Создаются:** `db/16_holidays.sql`, `backend/alembic/versions/0016_holidays.py`, `deploy/stamp_alembic_0016.sql`, `backend/app/modules/holidays/__init__.py`, `backend/app/modules/holidays/router.py`, `backend/app/modules/holidays/service.py`, `backend/tests/test_holidays.py`; `frontend/src/modules/holidays/strings.js`, `holidays.css`, `HolidaysAdminSection.jsx`, `lib/holidays.js`, `lib/holidays.test.js`, `components/YearCalendar.jsx`, `components/CalendarModal.jsx`, `components/HomeHolidays.jsx`, `components/DaysModal.jsx`; `frontend/src/core/api/mock/holidays.js`, `frontend/src/core/api/mock/holidays.test.js`.

**Меняются:** `backend/app/core/registry.py` (импорт + одна строка); `backend/tests/test_me.py` (один ключ), `backend/tests/test_database.py`; `frontend/src/modules/registry.js`; `frontend/src/core/api/mock/handlers.js`, `frontend/src/core/api/mock/data.js` (одно право пользователю 9); `db/README.md`; этот файл — только раздел «Отступления реализации».

**`db/README.md`** — раздел «Производственный календарь (ревизия 0016)» после раздела `0015`: что добавляет (таблица `holidays_days`, только исключения, сб/вс — автоматически); «SQL в корне `db/` по решению пользователя, вопреки конвенции `db/modules/`». **Выкат 0016:** 1) под doadmin в `defaultdb` выполнить `db/16_holidays.sql` (после `15_home_widgets.sql`); 2) `deploy/stamp_alembic_0016.sql` (`0015 → 0016`); 3) только после этого — merge в `main` (иначе `/modules/holidays/*` → 500); 4) admin в «Особых правах» (или группе) выдаёт Аревик «Ответственный» на «Производственный календарь»; 5) Аревик вносит праздники текущего и следующего года по обеим странам. **Откат** (`alembic downgrade 0015`): таблица и все внесённые дни удаляются.

## Не трогать
Существующие `db/*.sql`, `db/modules/**`, `deploy/*` (кроме нового stamp), ревизии `0001–0015`; `backend/tests/conftest.py`; `backend/app/core/` кроме `registry.py` (в т. ч. `access.py`, `deps.py`, `models.py`, `routes_core.py`, `home.py`, `routes_admin.py`); `/core/me` (новых полей нет — `holidays` сам появляется в `module_access`/`module_responsible`); модули `hr` (учёт праздников в отпусках `Q-D2` — не в этой задаче), `team`, `news`, `warehouse`, `wb` — бэкенд и фронт; `frontend/src/core/**` кроме `api/mock/holidays*.js`, `api/mock/handlers.js`, `api/mock/data.js` (в т. ч. `HubPage.jsx`, `home/asideWidgets.js`, `home/widgetConfig.js`, `access.js`, `layout/**`, `pages/**`, `admin/**`, `strings.js`, `styles.css`, `theme.js`, `dates.js`); `package.json`, `requirements.txt`, `vite.config.js`; `ARCHITECTURE.md`, `CLAUDE.md`, прочие `docs/*` (в т. ч. неотслеживаемый `docs/TZ-onboarding.md`); репозиторий purchasing_dashboard. Нужен другой файл — остановиться и вернуть вопрос.

---

## План
1. **БД:** `db/16_holidays.sql`, ревизия `0016`, stamp `0015 → 0016`, раздел `db/README.md`, `test_database.py` → проверка: `docker compose up -d postgres`, `cd backend && alembic upgrade head`; повторный прогон SQL; `alembic downgrade 0015` и снова `upgrade head`; `pytest backend/tests/test_database.py`.
2. **Бэкенд:** `modules/holidays/service.py` и `router.py`, строка в `core/registry.py`, `test_holidays.py`, ключ в `test_me.py` → `pytest backend/tests/test_holidays.py backend/tests/test_me.py`, затем полный `pytest`.
3. **Фронт-логика:** `lib/holidays.js` + тесты (тип дня, периоды отдыха, сетка, часовые пояса, группировка, валидация) → `npm test`.
4. **Mock:** `mock/holidays.js` + тест, подключение в `handlers.js`, право пользователю 9 в `data.js` → `npm test`.
5. **Фронт-UI:** `strings.js`, `YearCalendar`, `CalendarModal`, `HomeHolidays`, `DaysModal`, `HolidaysAdminSection`, `holidays.css`, две строки в `modules/registry.js` → `npm run lint`, `npm run build`.
6. **Демо-проверка (`VITE_DEMO_MODE=true`):** (а) employee «Ани С.»: виджет «Праздники и выходные» с двумя странами, модалка календаря, переключение стран и лет; пункта меню нет, `/modules/holidays` — «Не найдено»; (б) «Сотрудник HR»: пункт «Производственный календарь», ставит диапазон каникул, пробует `workday` на пн → ошибка, сбрасывает дни; после перезагрузки главной у Ани виджет и модалка показывают изменения; (в) viewer: виджета нет, запросов к API модуля нет; (г) «Виджеты главной» у редактора новостей: новый пункт в конце, выключается и перемещается; (д) светлая и тёмная тема, узкое окно.
7. Коммиты в ветку `holidays` — только когда пользователь разрешит; индексировать явными путями из «Файлы». Приёмка ревьюером. Заполнить «Отступления реализации».

## ТЗ для исполнителя
- Ветка `holidays`; не пушить, не создавать и не переключать ветки, не ребейзить. Коммитить — только по команде пользователя; при коммите `git add <путь>` **только** путями из «Файлы», никогда `git add -A` / `git add .` (лежит неотслеживаемый `docs/TZ-onboarding.md`).
- Перед стартом `ls backend/alembic/versions` → последняя `0015`; иначе — перенумерация по разделу «Номера миграций».
- Менять только файлы из «Файлы». Нужен другой — стоп, вопрос.
- Без новых зависимостей (Python/npm); `dayjs` — только как уже используется в HR для `RangePicker`; сетка календаря — своя разметка, не antd `Calendar`.
- Права — только через `module_rights` / `can_see_data` / `can_manage_users` (бэкенд) и `me.module_access` / `me.module_responsible` / `me.can_manage_users` (фронт). Новых таблиц и колонок прав нет; в `core/**` строка `holidays` появляется только в `core/registry.py` и mock-файлах.
- В БД — только исключения; сб/вс без строки — выходной. Не добавлять сиды, «стандартные выходные», внешние API, расчёт норм часов.
- Диапазон ≤ 31 дня, upsert; при нарушении правила — 422 на весь диапазон без частичной записи.
- Тип дня, сетка и «периоды отдыха» — только в `modules/holidays/lib/holidays.js`; компоненты их не дублируют. Mock не импортирует `modules/holidays/**` (ядро не импортирует модуль) и держит свою короткую проверку записи с комментарием «зеркало».
- Журнал — только ключи из решения 9, без названий.
- UI-строки — только в `modules/holidays/strings.js`; в JSX литералов нет. Текст — plain text, без `dangerouslySetInnerHTML`.
- Спорное — `TODO(Q-HC6)` и далее + запись в «Отступления реализации».

## Критерии приёмки для ревьюера
- [ ] Дифф только по «Файлы»; ничего из «Не трогать» не изменено (особо: `HubPage.jsx`, `asideWidgets.js`, `widgetConfig.js`, `routes_core.py`, `access.py`, `deps.py`, `conftest.py`, модуль `hr`); ничего не запушено; `docs/TZ-onboarding.md` не закоммичен.
- [ ] Ревизия `0016_holidays.py`, `down_revision = "0015"`, `SQL_FILES = ["16_holidays.sql"]`, одна голова; `db/16_holidays.sql` идемпотентен, шапка «ШАГ 16 … ПОСЛЕ 15_home_widgets.sql»; `deploy/stamp_alembic_0016.sql` — `0015 → 0016`; downgrade удаляет только `holidays_days`; README описывает выкат (включая выдачу права Аревик) и откат.
- [ ] Таблица `holidays_days`: PK `(country, day)`, CHECK стран, видов, длины `name`, диапазона дат; именованные `holidays_days_holiday_name_check` и `holidays_days_workday_check`; сидов и привязки к отделам нет.
- [ ] Ядро не знает модуля: в `core/` бэкенда — только импорт и строка манифеста (`for_all=True`, без `home_editor`); во фронт-ядре строка `holidays` есть только в mock-файлах.
- [ ] Права: viewer — 403 и нет виджета (и нет запросов к API модуля); employee — читает, запись 403; superuser без права — 403 на запись; responsible на `holidays` и admin — пишут; responsible только на `news` — не пишет. Пункт меню «Производственный календарь» виден только редакторам; остальным `/modules/holidays` — «Не найдено»; порядок прочих пунктов прежний; модуль есть в «Особых правах» и группах с `permissionHint`.
- [ ] Запись диапазоном: 1–8 января сохраняются одним действием (включая сб/вс); upsert перезаписывает; `workday` на пн–пт и `holiday` без названия → 422 **без частичной записи**; больше 31 дня, обратный порядок, 1999 год, лишний ключ → 422; удаление диапазоном возвращает дни к правилу сб/вс.
- [ ] `GET /days` — обе страны, сортировка `country, day`, ограничение 400 дней.
- [ ] Журнал `holidays.set` / `holidays.delete` с `module_id='holidays'`, без названий (есть тест); `holidays.delete` не пишется при `count = 0`.
- [ ] Виджет: Армения и Россия отдельно, до 3 ближайших периодов отдыха на 365 дней вперёд, периоды склеены с примыкающими выходными, обычные выходные без праздника не показаны, «сегодня» — в часовом поясе страны, текущий период с меткой «сейчас»; пустой календарь → «Ближайших праздников в календаре нет», без ошибок; один запрос при монтировании.
- [ ] Модалка: 12 месяцев, пн первый; смена страны — без запроса, года — с запросом; различимы праздник, выходной (перенос), обычный выходной, рабочий (перенос), сокращённый — в том числе без цвета (маркер); легенда; список праздников года с названиями; читается в светлой и тёмной теме; на узком экране без горизонтальной прокрутки страницы.
- [ ] Раздел редактора: выбор страны и года, клик по дню открывает форму с текущими значениями, «Отметить дни» для диапазона, «Сбросить дни», список диапазонов с «Изменить / Удалить»; ошибки сервера показываются, окно не закрывается.
- [ ] Главная: виджет в правой колонке; в «Виджетах главной» появился сам, при сохранённой настройке — в конце и включён; его можно выключить и переместить; `HubPage.jsx` не изменён.
- [ ] Логика дней — одна чистая функция в `lib/holidays.js` с тестами (граница года, рабочая суббота, часовые пояса около полуночи); компоненты её не копируют; `core/**` (включая mock) не импортирует `modules/holidays/**`, проверка записи в mock помечена как зеркало.
- [ ] Mock повторяет контракт, права и коды; демо-редактор — пользователь 9; демо-данные помечены как вымышленные; сценарии плана (шаг 6) без ошибок в консоли.
- [ ] `test_me.py` учитывает `holidays`; `test_database.py` ожидает `0016` в обоих местах и проверяет права hub_app; `pytest`, `npm test`, `npm run lint`, `npm run build` — зелёные.
- [ ] В конце файла — «Отступления реализации» (или явное «нет»).

## Закрытые вопросы (решения по умолчанию, lead 2026-10-29; пересмотр — отдельной задачей)
- **Q-HC1** — выходные сб и вс для обеих стран; шестидневка (часть организаций Армении) не учитывается.
- **Q-HC2** — viewer не видит виджет и календарь (как новости): праздники считаются данными, а не «структурой».
- **Q-HC3** — superuser без явного права «Ответственный» календарь не редактирует (как `Q-N3`).
- **Q-HC4** — защиты от одновременной правки нет: последняя запись побеждает.
- **Q-HC5** — нормы рабочих дней и часов по месяцам не считаются и не показываются.
- Модуль — отдельный `holidays` (не `news`, не `calendar`); Аревик получает «Ответственный» на нём вручную при выкате.
- SQL — `db/16_holidays.sql` в корне `db/` по просьбе пользователя (отступление от конвенции `db/modules/<id>/`).
- Виджет — в правой колонке главной, по умолчанию после «Отпуска»; у существующей настройки — в конце и включён; `home_editor` у модуля нет.
- Порядок стран — Армения, затем Россия (как часы на главной); год в модалке по умолчанию — текущий.
- Запись — диапазон не больше 31 дня, чтение — период не больше 400 дней; `short` на сб/вс означает рабочую сокращённую субботу (воскресенье).

## Отступления реализации
1. **Лишний файл вне списка «Файлы»:** `frontend/src/modules/holidays/lib/useYearDays.js` — хук загрузки строк за год (общий для `CalendarModal` и `HolidaysAdminSection`, чтобы не копировать запрос; по образцу `team/lib/useLeave.js`). В `lib/holidays.js` хук нельзя (там нет React), в файле компонента — нельзя (oxlint `react/only-export-components` + `--deny-warnings`).
2. Общая панель «страна + год» — именованный компонент `YearToolbar` в `components/YearCalendar.jsx` (не отдельный файл).
3. `DaysModal` импортирует `dayjs` напрямую (уже в `package.json`, новых зависимостей нет): в HR `RangePicker` нигде не получает начальное значение, а форме правки оно нужно; прецедент прямого импорта — `wb/marking/MarkingTab.jsx`.
4. Сообщение о `workday` на будний день везде (бэкенд, `validateRange`, mock) — «<текст>: ДД.ММ.ГГГГ, …» (до 5 дат), как в ТЗ для сервера; `strings.errors.workdayWeekend` содержит только основной текст.
5. Список раздела редактора группирует подряд идущие одинаковые строки, и склеенный диапазон может оказаться длиннее 31 дня (несколько записей подряд). «Удалить» в этом случае шлёт запросы частями по 31 день; «Изменить» такого диапазона вернёт ошибку `validateRange` («Не больше 31 дня за один раз») — правка по частям. Решение не принималось, оставлено как есть.
6. Бэкенд: ошибки типов тела (страна, вид, лишний ключ, имя > 100) отдаёт стандартная валидация Pydantic (422, `detail` — список); русские `MSG_*` — для правил календаря (порядок, 31 день, 400 дней, 2000–2100, название, workday).
7. Строки модуля сверх перечня из ТЗ: `monthsGenitive`, `monthsShort`, `home.fallbackName`, `home.daysShort`, `calendar.country`, `calendar.dayTitle`, `admin.*` (подписи формы, подтверждения, `confirmYes/No`); `errors.forbidden/notFound/invalid/datesRequired/datesOutOfRange/...` для mock.
8. Демо-проверка в браузере (шаг 6 плана) не выполнялась: проверены сборка, линт и логика тестами; визуальную проверку (светлая/тёмная тема, узкое окно, сценарии (а)-(г)) нужно сделать вручную.
9. Новые файлы сохранены с CRLF (как остальные файлы репозитория).
10. Открытых вопросов `Q-HC*` сверх закрытых `Q-HC1`–`Q-HC5` нет (в коде оставлены `TODO(Q-HC1)`, `TODO(Q-HC3)`, `TODO(Q-HC4)`).
