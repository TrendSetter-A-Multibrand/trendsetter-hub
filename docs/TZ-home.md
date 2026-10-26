# ТЗ: новая главная страница, этап 1 (часы, погода, курсы, ДР, отпуска, «Мои инструменты»)

Статус: решения пользователя 2026-10-26, ветка `dev-karen`. ТЗ — lead; факты по MET Norway и ЦБ проверены живыми запросами 2026-10-26 (см. «Проверенные факты»). Контракт заморожен. Любое отступление — открытый вопрос `TODO(Q-Hn)`, поднимается пользователю.

## Решения (не пересматривать)
1. Главная — информативная сводка, а не дубль левого меню. Hero (приветствие + дата) остаётся **без изменений**. Большие карточки модулей заменяются компактной полосой «Мои инструменты».
2. **Мини-часы** — только фронтенд (`Intl.DateTimeFormat`): Ереван `Asia/Yerevan`, Москва `Europe/Moscow`, Париж `Europe/Paris`, Нью-Йорк `America/New_York`; обновление раз в минуту (по границе минуты).
3. **Погода на 7 дней** (Ереван, Москва) — MET Norway Locationforecast 2.0, вариант **`complete`** (только в нём у `next_6_hours` есть `air_temperature_max/min`, см. факты). Запрашивает **только бэкенд**: `GET /core/home/weather`; кэш в памяти процесса; при сбое — последний кэш или пустые дни. Атрибуция «Данные: MET Norway» в интерфейсе.
4. **Курсы ЦБ РФ** (USD, EUR, AMD к RUB) — `GET /core/home/rates`, источник `https://www.cbr-xml-daily.ru/daily_json.js` (JSON-зеркало официальных курсов ЦБ, UTF-8). Почему не `cbr.ru/scripts/XML_daily.asp`: XML в windows-1251 с десятичной запятой и периодическая недоступность `cbr.ru` для зарубежных IP (сервер DO — вне РФ). Смена источника — `TODO(Q-H2)`. Номинал отдаётся как есть (AMD: `Nominal = 100`).
5. **Дни рождения (ближайшая неделя) и отпуска (сегодня / ближайшие)** — из **существующих** эндпоинтов `GET /modules/hr/birthdays?month=YYYY-MM` и `GET /modules/hr/leave/calendar?from=&to=`. **Новый `/core/home/people` не делается** — обоснование и приватность ниже.
6. Внешние HTTP-запросы выполняются в обработчике `GET` (не в воркере) — осознанное исключение из правила «тяжёлое — в воркере»: лёгкий GET, таймаут 5 с, не чаще раза в час, под блокировкой. Процесс uvicorn один (`backend/Dockerfile`), поэтому кэш в памяти корректен; при нескольких процессах — `TODO(Q-H4)`.
7. Без миграций, без БД, без секретов, без новых зависимостей: HTTP-клиент — `httpx` (уже в `backend/requirements.txt`, ставится в прод-образ целиком).
8. **Граница ядро/модуль во фронтенде.** Часы, погода, курсы, «Мои инструменты», «Последние запуски» — ядро (`frontend/src/core/home/`). Блоки ДР и отпусков принадлежат модулю `team` и подключаются через новый список **`HOME_WIDGETS`** в `frontend/src/modules/registry.js` — по образцу существующего `PROFILE_SECTIONS`. Ядро не импортирует `modules/team/*` напрямую. Будущий блок «Новости» (этап 2) добавится одной строкой в `HOME_WIDGETS` без переделки раскладки.

## Приватность (блоки ДР и отпусков)
- Модуль `team` объявлен с `for_all=True` (`backend/app/core/registry.py`): любой активный `employee` получает минимум `view`. `/modules/hr/birthdays` и `/modules/hr/leave/calendar` закрыты зависимостью `team_viewer` (`can_see_data`) — сотрудникам они **уже доступны**, те же данные они видят в «Карте команды» (вид «Отпуска»).
- `viewer` получает `structure` — эндпоинты отвечают ему 403; это соответствует правилу «viewer видит только интерфейс». На главной блоки ДР/отпусков для него **не рендерятся вовсе** (без заглушки «Нет доступа»). Условие: `canSeeData(me.module_access.team)`.
- Что отдаёт сервер (не меняется): ДР — `personId, name, directionId, day, month` (без года и возраста; без `birthday_hidden`, архивных и `show_in_map=false`); календарь — `personId, name, directionId, kind, start, end`, только `approved`, **без больничных** (`kind <> 'sick'` на сервере), без архивных и `show_in_map=false`.
- Главная **не показывает** `kind` (вид отпуска), сообщения и причины — только имя и даты («до 30.10», «с 03.11»). Новых данных никому не открывается.
- «Уволенные» в проекте — `people.is_archived = true` (смена статуса «Работает → Уволен» в team); оба запроса их уже исключают. Человек не в архиве, но с прошедшей `dismissed_at` в досье, будет виден — `TODO(Q-H5)`, на этапе 1 не меняем.

## Проверенные факты (2026-10-26, живые запросы)
**MET Norway**
- URL: `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=40.1792&lon=44.4991`.
- Ответ — GeoJSON `Feature`: `properties.meta.updated_at` (UTC ISO); `properties.timeseries[]` = `{time: "2026-10-26T07:00:00Z", data: {instant: {details: {air_temperature, ...}}, next_1_hours?: {summary: {symbol_code}, details: {precipitation_amount}}, next_6_hours?: {summary: {symbol_code}, details: {air_temperature_max, air_temperature_min, precipitation_amount}}, next_12_hours?: {summary: {symbol_code}}}}`.
- В `compact` у `next_6_hours.details` только `precipitation_amount` — поэтому `complete`.
- Шаг: примерно первые 60 ч — почасово, дальше — каждые 6 ч (00/06/12/18 Z), всего около 9 суток (92 точки). Последние точки могут быть без `next_*`. 7 местных дней покрываются.
- Заголовки ответа: `Last-Modified`, `Expires` (RFC 1123). `If-Modified-Since` с прежним `Last-Modified` возвращает **304** (проверено).
- `symbol_code`: например `clearsky_day`, `fair_night`, `partlycloudy_day`, `cloudy`, `lightrain`, `rain`, `lightrainshowers_day`, `rainshowers_night`; суффиксы `_day` / `_night` / `_polartwilight`.
- По условиям MET (подтвердить technical-analyst, T-H1): User-Agent обязан идентифицировать приложение и контакт (иначе 403); координаты — не более 4 знаков после запятой; не запрашивать чаще, чем позволяет `Expires`; 429 — троттлинг; 203 — устаревшая версия API; атрибуция обязательна.

**ЦБ РФ (cbr-xml-daily.ru)**
- Пример: `{"Date": "2026-10-24T11:30:00+03:00", "PreviousDate": "2026-10-23T11:30:00+03:00", "Timestamp": "...", "Valute": {"AMD": {"CharCode": "AMD", "Nominal": 100, "Value": 22.3011, "Previous": 22.4519}, "USD": {"Nominal": 1}, "EUR": {}}}`.
- `Date` — дата, на которую установлен курс (может быть выходным днём); `Value` — рублей за `Nominal` единиц.
- В понедельник утром (до публикации нового курса) `Date` — суббота: это нормальное поведение ЦБ, а не устаревший кэш; `stale` такой ответ не помечает.

## API
Оба эндпоинта: `Depends(get_current_user)` — любой активный пользователь, **включая viewer** (это не данные компании); без токена — 401. Ответ всегда 200 с корректной формой, даже если источник недоступен; 5xx наружу не отдавать; в лог — только тип ошибки (`log.warning("home weather: %s", type(exc).__name__)`), без тела ответа.

### `GET /core/home/weather`
```json
{
  "source": "MET Norway",
  "cities": [
    {
      "id": "yerevan",
      "timezone": "Asia/Yerevan",
      "updatedAt": "2026-10-26T07:17:39Z",
      "stale": false,
      "days": [
        {"date": "2026-10-26", "min": 8, "max": 17, "symbol": "clearsky"},
        {"date": "2026-10-27", "min": 7, "max": 16, "symbol": "partlycloudy"}
      ]
    },
    {"id": "moscow", "timezone": "Europe/Moscow", "updatedAt": null, "stale": false, "days": []}
  ]
}
```
- `cities` — всегда ровно два города в порядке `yerevan`, `moscow`; нет данных — `days: []`, `updatedAt: null`.
- `days` — до 7 элементов: местные даты города начиная с **сегодня в зоне города** (вычисляется в момент ответа, не в момент кэширования), подряд по возрастанию; даты без данных (конец прогноза) не выводятся.
- `min`/`max` — целые °C, округление half-up: `math.floor(x + 0.5)`. `symbol` — код без суффикса `_day|_night|_polartwilight` или `null`.
- `stale: true` — последняя попытка обновления не удалась, отдан старый кэш.
- `updatedAt` — `properties.meta.updated_at` закэшированного ответа.

**Города (константы в коде):** `yerevan` — 40.1792, 44.4991, `Asia/Yerevan`; `moscow` — 55.7558, 37.6173, `Europe/Moscow`. Ровно 4 знака после запятой.

**Агрегация по дням** (чистая функция; зона — зона города через `zoneinfo`):
- Для каждой точки: `t` = `time` (UTC) -> `t_local`; дата `D = t_local.date()`.
- Температуры дня `D`: все `instant.details.air_temperature` точек с датой `D`, **плюс** `next_6_hours.details.air_temperature_min/max` тех точек, у которых интервал `[t_local, t_local + 6 ч]` целиком лежит в дне `D` (конец не позже следующей местной полуночи включительно). Интервалы, пересекающие полночь, вклад min/max не дают. `min = min(...)`, `max = max(...)`; нет значений — дня нет.
- Символ дня `D`: (1) среди точек дня с `next_6_hours`, у которых `t_local <= 12:00 < t_local + 6 ч`, — с самым поздним `t_local`; (2) иначе — точка дня с `next_6_hours`, ближайшая к 12:00 местного (при равенстве — более ранняя); (3) иначе то же по `next_1_hours`; (4) иначе `null`. Суффикс срезается регуляркой `_(day|night|polartwilight)$`.
- Сегодняшний день неполный (min/max по оставшимся часам) — допустимо, в UI не помечается.
- Агрегат кэшируется словарём `{date: {...}}` по всем датам прогноза; при ответе выбираются даты >= сегодня (зона города), первые 7.

**Кэш и обращения к MET** (на город; один `threading.Lock` на погоду):
- Состояние: `days_by_date`, `updated_at`, `fetched_at`, `expires_at`, `last_modified`, `next_try_at`, `failed`.
- Обновлять, только если `now >= max(fetched_at + 3600, expires_at)` **и** `now >= next_try_at`; иначе отдать кэш.
- Запрос: `GET`, заголовок `User-Agent: TrendsetterHub/1.0 (+https://trendsettercrew.com)` (константа; `TODO(Q-H3)` — подтвердить контакт), `If-Modified-Since: <last_modified>` если он есть; таймаут 5 с.
- **200**: разобрать (ошибка разбора = сбой); обновить `days_by_date`, `updated_at`, `fetched_at = now`, `expires_at` из `Expires` (нет/не разобрался — `now`), `last_modified` из `Last-Modified`, `failed = False`.
- **304**: данные не трогать; `fetched_at = now`, `expires_at` из заголовка, `failed = False`.
- **Сбой** (таймаут, сеть, любой другой статус, включая 203/403/429, ошибка разбора): `next_try_at = now + 600`, `failed = True`; кэш не трогать.
- Отдача: если данных нет или `fetched_at` старше 24 ч — у города `days: []`, `updatedAt: null`; `stale = failed and bool(days)`.
- Время — через функцию модуля `_now()` (подменяется в тестах). Сеть — только через функцию модуля `_http_get(url, headers) -> httpx.Response` (внутри `httpx.get(url, headers=headers, timeout=5.0)`); тесты подменяют её. `reset_cache()` — для тестов.

### `GET /core/home/rates`
```json
{
  "source": "ЦБ РФ",
  "date": "2026-10-24",
  "previousDate": "2026-10-23",
  "stale": false,
  "rates": [
    {"code": "USD", "nominal": 1, "value": 81.1234, "previous": 80.9876, "perUnit": 81.1234},
    {"code": "EUR", "nominal": 1, "value": 94.5, "previous": 94.7, "perUnit": 94.5},
    {"code": "AMD", "nominal": 100, "value": 22.3011, "previous": 22.4519, "perUnit": 0.223011}
  ]
}
```
- Порядок USD, EUR, AMD; валюта, которой нет в ответе источника, пропускается.
- `date`/`previousDate` — из `Date`/`PreviousDate` (первые 10 символов ISO). `value`/`previous` — как есть; `perUnit = round(value / nominal, 6)`.
- Нет данных: `{"source": "ЦБ РФ", "date": null, "previousDate": null, "stale": false, "rates": []}`.
- Кэш: обновлять, если `now >= fetched_at + 3 ч` и `now >= next_try_at`; сбой — `next_try_at = now + 600`, `stale = true` при наличии данных; данные старше 4 суток не отдаются (пустой ответ). Условных запросов нет; тот же `_http_get`, тот же User-Agent, таймаут 5 с.

## Фронтенд

**Раскладка `HubPage`** (сверху вниз):
1. Hero — без изменений.
2. «Мои инструменты» — компактная полоса на всю ширину.
3. Сетка `.home-grid`: при ширине >= 1100px две колонки `minmax(0, 2fr) minmax(0, 1fr)`; уже — одна колонка (сначала side, потом main).
   - **main**: Погода -> виджеты `HOME_WIDGETS` с `area: 'main'` (на этапе 1 их нет) -> «Последние запуски» (только при `hasData`).
   - **side**: Часы -> Курсы -> виджеты `HOME_WIDGETS` с `area: 'side'` (ДР, затем Отпуска).
- Каждый блок — карточка `.home-card` (белый фон, `1px solid var(--border)`, `border-radius: 4px`, как `.runs`), заголовок — mono-подпись (`.mono`, 11px, `letter-spacing: .1em`, `color: var(--muted)`). Акцент — `var(--red)`. Новые цветовые токены не вводить.
- Каждый блок сам грузит свои данные; ошибка/пустота блока не ломает страницу и другие блоки; во время загрузки — `Spin size="small"`.
- Пустую заглушку под «Новости» не рисовать.

**«Мои инструменты»** (`.tools-strip`): горизонтальный ряд плашек-ссылок с переносом. Модули из `MODULES` (порядок реестра) с `me.module_access[id] !== 'none'`. В плашке: `strings.dept` (mono, красный, 10px), `strings.title`, бейдж `me.module_badges[id]` если > 0 (класс `.badge`, `aria-label` — `strings.layout.moduleBadge(n)`). `status === 'roadmap'` — приглушённая плашка (opacity, как `.nav-item.dim`). Ссылка — `/modules/<id>`. Иконок нет (`TODO(Q-H6)`). Счётчик `[NN]` рядом с заголовком оставить.

**«Последние запуски»** — рендерится **только при `hasData`** (для пользователя без данных секции нет вовсе; `NoDataAccess` на главной убрать). Компактнее: модификатор `.runs.compact` с меньшим padding у `.run-row`. Ссылку «Все запуски» -> `/modules/purchasing`, `GET /core/runs?limit=5` и разметку строки не менять.

**Часы** (`core/home/ClocksCard.jsx`, логика — `core/home/clocks.js`): сетка 2x2, город (mono) + `HH:MM` (крупно, `font-variant-numeric: tabular-nums`). Тик: `setTimeout` до начала следующей минуты, затем `setInterval(60000)`; очистка при размонтировании. `clocks.js`: `CLOCK_ZONES = [{ id: 'yerevan', timeZone: 'Asia/Yerevan' }, ...]`, `formatClock(date, timeZone)` -> `'HH:MM'` через `Intl.DateTimeFormat('ru-RU', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })`. Подписи городов — `strings.hub.home.cities`.

**Погода** (`core/home/WeatherCard.jsx`, логика — `core/home/weather.js`):
- По строке на город: название + 7 ячеек (день недели и число `пн 27` — mono; `max°` жирным, `min°` muted; короткая подпись погоды).
- Город с `days: []` — строка «нет данных». Оба города пустые или запрос упал — весь блок: `strings.hub.home.weatherUnavailable` («Погода недоступна»).
- `stale` у города — mono-пометка «данные могут быть устаревшими».
- Внизу атрибуция «Данные: MET Norway» — ссылка `https://www.met.no/en`, `target="_blank" rel="noreferrer"`.
- `weather.js`: `weatherKind(symbol)` -> `clear | partly | cloudy | fog | rain | sleet | snow | thunder | null`, порядок проверки подстрок: `thunder` -> thunder; `sleet` -> sleet; `snow` -> snow; `rain` или `showers` -> rain; `fog` -> fog; `partlycloudy` или `fair` -> partly; `cloudy` -> cloudy; `clearsky` -> clear; иначе null. `formatTemp(n)` -> `'+5°'`, `'0°'`, `'−3°'` (минус U+2212). `dayLabel(iso)` -> `'пн 27'` (день недели — из нового ключа `strings.hub.home.weekdays = ['вс','пн','вт','ср','чт','пт','сб']` по индексу `getUTCDay()`; дата разбирается через `parseIso` из `core/dates.js`, без часового пояса браузера). Подписи видов — `strings.hub.home.weatherKinds`; иконок нет (`TODO(Q-H6)`).

**Курсы** (`core/home/RatesCard.jsx`, логика — `core/home/rates.js`): заголовок «Курсы ЦБ РФ на 24.10.2026» (`formatDate` из `core/dates.js`); строки `1 USD = 81,12 ₽` и изменение `+0,14` / `−0,15` (muted, mono); AMD — `100 AMD = 22,30 ₽`. `rates.js`: `rateRows(data)` -> `[{ code, label: '100 AMD', value: '22,30 ₽', delta: '−0,15', direction: 'up' | 'down' | 'flat' }]`; формат `Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })`; `delta = value - previous` (за номинал); `flat` при |delta| < 0.005. Пусто/ошибка — «Курсы недоступны». `stale` — та же пометка, что у погоды.

**Блоки модуля team (через `HOME_WIDGETS`)**
- `frontend/src/modules/registry.js`:
  ```js
  export const HOME_WIDGETS = [
    { id: 'birthdays', area: 'side', visible: (me) => canSeeData(me.module_access.team), Component: lazy(() => import('./team/components/HomeBirthdays.jsx')) },
    { id: 'leave', area: 'side', visible: (me) => canSeeData(me.module_access.team), Component: lazy(() => import('./team/components/HomeLeave.jsx')) },
  ]
  ```
  `canSeeData` — из `../core/access.js`. `HubPage` рендерит видимые виджеты своей колонки внутри `Suspense`, передаёт `{ me }`.
- `HomeBirthdays.jsx`: `today = todayIso()`; месяцы `monthKey(today)` и `monthKey(addDays(today, UPCOMING_DAYS))` -> существующие `useBirthdays(months, true)` и `upcomingBirthdays(entries, today)` из `team/lib`. Строка: имя + «сегодня / завтра / через N дн.» (`strings.birthdays.today/tomorrow/inDays`), заголовок `strings.birthdays.title`, пусто — `strings.birthdays.empty` (всё уже есть в `team/strings.js`). Эмодзи-маркер `strings.birthdays.marker` на главной не выводить.
- `HomeLeave.jsx`: существующий `useLeaveRange(today, addDays(today, 14), true)` + новая чистая функция `homeLeave(items, today, days = 14)` в `team/lib/leave.js` -> `{ away: [{ personId, name, end }], upcoming: [{ personId, name, start, end }] }`.
  - `away`: интервалы, содержащие `today`; один человек — одна запись с максимальным `end`; сортировка по `end`, затем имени (`localeCompare(..., 'ru')`).
  - `upcoming`: `today < start <= today + days`; сортировка по `start`, затем имени; дубли одного человека с одинаковым `start` схлопываются.
  - `kind` в результат **не попадает**.
  - Показ: «Сегодня в отпуске» — имя · «до DD.MM»; «Ближайшие отпуска» — имя · «с DD.MM». В каждом списке не более 5 строк, дальше «ещё N» — ссылка на `/modules/team?view=leave`. Пусто: «Сегодня все на месте» / «В ближайшие 2 недели отпусков нет». Ошибка — `strings.leave.loadError`.
  - Новые строки — в `team/strings.js`, ключ `home` (см. Q-H1).

**Строки**
- Ядро — `frontend/src/core/strings.js`, ключ `hub.home`: `toolsTitle`, `clocksTitle`, `cities { yerevan, moscow, paris, newYork }`, `weatherTitle`, `weatherUnavailable`, `noData`, `stale`, `weatherSource`, `weatherKinds { ... }`, `weekdays`, `ratesTitle(date)`, `ratesUnavailable`.
- Виджеты team — `frontend/src/modules/team/strings.js` (конвенция модулей: у модуля свой `strings.js`; переиспользуется существующий `birthdays`). Расхождение с формулировкой «все строки в core/strings.js» — `TODO(Q-H1)`.
- После удаления карточек ключи `hub.modulesTitle`, `hub.openTool`, `hub.inDevelopment` становятся неиспользуемыми — удалить (`strings.admin.groups.modulesTitle` — другой ключ, не трогать). CSS `.card*` используется в модулях — не удалять.

**Mock (VITE_DEMO_MODE)**
- Новый `frontend/src/core/api/mock/home.js`: обработчики `GET /core/home/weather`, `GET /core/home/rates`; оба вызывают `userFromToken(token)` (без токена — 401, как остальные core-обработчики).
- Погода: детерминированные данные на 7 дней от `todayIso()` для обоих городов (например, синусоида по индексу дня; символы по кругу из реальных кодов), `stale: false`, `updatedAt` — текущее время ISO. Курсы: фиксированные значения из примера выше, `date` — сегодня.
- Регистрация — спредом в `handlers` в `mock/handlers.js`. Mock ДР и календаря уже есть (`hr-plans.js`, `hr.js`) — не трогать.

## Файлы
**Создаются**
- `backend/app/core/home.py` — константы городов/валют, `_now`, `_http_get`, чистые `aggregate_days(...)`, `pick_symbol(...)`, `parse_rates(...)`, кэш, `weather_payload()`, `rates_payload()`, `reset_cache()`.
- `backend/tests/test_home.py`.
- `frontend/src/core/home/clocks.js`, `clocks.test.js`, `weather.js`, `weather.test.js`, `rates.js`, `rates.test.js`, `ClocksCard.jsx`, `WeatherCard.jsx`, `RatesCard.jsx`.
- `frontend/src/core/api/mock/home.js`, `home.test.js`.
- `frontend/src/modules/team/components/HomeBirthdays.jsx`, `HomeLeave.jsx`.

**Меняются**
- `backend/app/core/routes_core.py` — два маршрута (тонкие обёртки над `home.py`).
- `frontend/src/core/pages/HubPage.jsx`.
- `frontend/src/core/styles.css` — только новые классы: `.home-grid`, `.home-col`, `.home-card`, `.home-card-head`, `.tools-strip`, `.tool-chip` (+ `.dim`), `.clocks`, `.weather-*`, `.rates-*`, `.people-*`, `.runs.compact .run-row`, медиазапрос 1100px.
- `frontend/src/core/strings.js` — `hub.home` + удаление трёх ключей.
- `frontend/src/core/api/mock/handlers.js` — одна строка регистрации.
- `frontend/src/modules/registry.js` — `HOME_WIDGETS`.
- `frontend/src/modules/team/lib/leave.js` (`homeLeave`), `frontend/src/modules/team/lib/leave.test.js`.
- `frontend/src/modules/team/strings.js` — ключ `home`.
- `docs/TZ-home.md` — раздел «Отступления реализации» по итогам.

**Не трогать:** бэкенд HR/team (роутеры, сервисы, права), `/core/me`, `/core/runs`, `backend/requirements.txt`, `frontend/package.json`, Alembic и `db/`, `backend/tests/conftest.py`, `AppLayout`/меню, `vite.config.js`, `ARCHITECTURE.md`, `CLAUDE.md`, репозиторий purchasing_dashboard.

## Тесты (сеть запрещена)
**Бэкенд — `backend/tests/test_home.py`.** Autouse-фикстура: `home.reset_cache()` и подмена `home._http_get` функцией, которая бросает `AssertionError("network")`; тесты, которым нужен ответ, подставляют фейк, возвращающий `httpx.Response(status, json=..., headers=...)`.
- Чистые функции — без БД (не используют фикстуры `client`/`clean`), выполняются всегда:
  1. `aggregate_days` на синтетической сетке в формате MET (почасовые точки через местную полночь + 6-часовые): день — в зоне города (точка `2026-10-26T21:00:00Z` — это 27.10 для `Asia/Yerevan`); min/max учитывают `next_6_hours` только внутри дня; интервал через полночь не влияет; символ — слот, покрывающий 12:00, суффикс срезан; запасной вариант по `next_1_hours`; хвостовая точка без `next_*` не ломает; округление half-up (в т. ч. отрицательные).
  2. Выбор 7 дней от «сегодня» зоны города при подменённом `_now`: вчерашние даты отброшены; меньше 7 дней в конце прогноза — ок.
  3. `parse_rates`: USD/EUR/AMD, у AMD `nominal = 100` и `perUnit`; отсутствующая валюта пропускается; даты.
  4. Кэш погоды: второй вызов в пределах часа не ходит в сеть; после часа и `Expires` — запрос с `If-Modified-Since`, 304 сохраняет данные; User-Agent содержит `TrendsetterHub`; в URL `/complete` и координаты ровно с 4 знаками; сбой — старые данные + `stale: true`, повтор не раньше чем через 600 с; сбой без кэша — `days: []`; данные старше 24 ч не отдаются; 429 и 203 — сбой.
  5. Кэш курсов: TTL 3 ч; сбой — stale; данные старше 4 суток не отдаются; пустой ответ правильной формы.
- Эндпоинты (фикстуры с БД, как в соседних тестах; без `HUB_TEST_ADMIN_DSN` пропускаются): без токена 401; `employee` и `viewer` — 200 и правильная форма; при сбое источника — 200, не 5xx.

**Фронтенд (`node --test`)**
- `clocks.test.js`: дата `2026-01-15T12:00:00Z` -> Ереван `16:00`, Москва `15:00`, Париж `13:00`, Нью-Йорк `07:00`; летняя дата — сдвиг DST у Парижа и Нью-Йорка.
- `weather.test.js`: `weatherKind` по всем ветвям, `formatTemp`, `dayLabel`.
- `rates.test.js`: AMD с номиналом 100, знак/направление изменения, flat, пустые данные.
- `leave.test.js`: новые кейсы `homeLeave` — пересечение с `today`; несколько отпусков одного человека -> максимальный `end`; граница `today + 14` включительно; отпуск, начавшийся вчера, — в `away`, а не в `upcoming`; в результате нет `kind`.
- `mock/home.test.js`: 401 без токена; 7 дней от сегодня у обоих городов; курсы в порядке USD/EUR/AMD.
- Прогоны: `npm test`, `npm run lint`, `npm run build`, `pytest`.

## Открытые вопросы
- **Q-H1**: строки виджетов team — в `modules/team/strings.js` (конвенция модулей + переиспользование `birthdays`), а не в `core/strings.js`. Подтвердить.
- **Q-H2**: источник курсов — неофициальное зеркало `cbr-xml-daily.ru`. Переходить на официальный XML ЦБ (cp1251) или добавить его запасным? Сначала проверить доступность `cbr.ru` с сервера DO.
- **Q-H3**: контакт в User-Agent для MET (сейчас домен `trendsettercrew.com`); нужен ли e-mail.
- **Q-H4**: общий кэш при нескольких процессах/воркерах (сейчас процесс один).
- **Q-H5**: человек с прошедшей `dismissed_at`, но не в архиве, виден в ДР/отпусках.
- **Q-H6**: иконки погоды (MET weathericons, MIT) и иконки модулей в «Моих инструментах».
- **Q-H7**: нужны ли другие города/валюты (сейчас жёсткие константы).

## Проверка фактов (technical-analyst, до старта реализации)
- **T-H1**: Terms of Service MET Norway — требования к User-Agent, лимит знаков координат, частота запросов, формулировка атрибуции, допустимость кэша на 1 час.
- **T-H2**: доступность `cbr.ru` и `cbr-xml-daily.ru` с IP DigitalOcean (регион прод-сервера); условия использования `cbr-xml-daily.ru`.
- **T-H3**: `Intl.DateTimeFormat` с `hourCycle: 'h23'` и `timeZone` в целевых браузерах и в Node для тестов (полные ICU-данные в Node 13+ по умолчанию).

---

## План
1. Бэкенд: чистые функции `home.py` (агрегация MET, разбор ЦБ) + тесты -> проверка: `pytest backend/tests/test_home.py` (чистые тесты идут без БД).
2. Бэкенд: кэш, `_http_get`, два маршрута в `routes_core.py` + тесты кэша и эндпоинтов -> проверка: `pytest` зелёный; поиск по коду: внешний HTTP только в `_http_get`.
3. Фронт: `core/home/*.js` (часы, погода, курсы) + тесты -> проверка: `npm test`.
4. Фронт: `mock/home.js` + регистрация + тест -> проверка: `npm test`; в демо-режиме главная с данными.
5. Фронт: `homeLeave` в `team/lib/leave.js` + тест; `HomeBirthdays`/`HomeLeave`; `HOME_WIDGETS` в реестре -> проверка: `npm test`; demo под employee и под viewer.
6. Фронт: новый `HubPage` (раскладка, полоса инструментов, компактные запуски, карточки), CSS, строки -> проверка: `npm run lint`, `npm run build`, ручная проверка на 1440px и 800px.
7. Дописать в этот файл раздел «Отступления реализации».

## ТЗ для исполнителя
Делать строго по разделам «Решения», «API», «Фронтенд», «Файлы», «Тесты» выше. Дополнительно:
- Менять только файлы из списка «Файлы». Нужен другой файл — остановиться и вернуть вопрос.
- Не добавлять зависимости (ни Python, ни npm); `requirements.txt` и `package.json` не трогать.
- Миграций нет; `home.py` не обращается к БД.
- Внешний HTTP — только через `home._http_get`; больше нигде нет `httpx`/`fetch` к внешним хостам; фронт ходит только в `/core/home/*`.
- Ошибки источников наружу не пробрасывать: всегда 200 и корректная форма; в лог — только тип исключения (без тела ответа).
- UI-строки — только в `core/strings.js` (ядро) и `modules/team/strings.js` (виджеты team); в JSX нет текстовых литералов, кроме символов `°`, `₽`, `=`, `·`.
- Ядро (`frontend/src/core/**`) не импортирует `frontend/src/modules/team/**`; связь — только через `HOME_WIDGETS` в `modules/registry.js`.
- Не менять HR/team эндпоинты, `/core/me`, `/core/runs`, ссылку «Все запуски», hero.
- Всё спорное — `TODO(Q-Hn)` в коде + запись в разделе «Отступления реализации».

## Критерии приёмки для ревьюера
- [ ] В диффе только файлы из списка «Файлы»; нет миграций и изменений в `requirements.txt`, `package.json`, `conftest.py`, бэкенде HR/team, `AppLayout`, `vite.config.js`.
- [ ] `GET /core/home/weather` и `GET /core/home/rates` возвращают ровно описанную форму (camelCase, порядок городов и валют); без токена 401; viewer — 200.
- [ ] Запрос к MET: путь `/locationforecast/2.0/complete`, координаты с 4 знаками, `User-Agent` с именем приложения и контактом, `If-Modified-Since` при повторе; учитывается `Expires`; 304 не стирает данные.
- [ ] Сбой источника (таймаут, 5xx, 429, 203, битый JSON) -> 200, старый кэш с `stale: true` или пустые данные; повтор не раньше чем через 10 минут; в логе нет тела ответа.
- [ ] День погоды считается в зоне города; min/max включают `next_6_hours` только внутри дня; символ без суффикса; первый день — «сегодня» в зоне города.
- [ ] Курсы: у AMD `nominal: 100`, `perUnit = value / 100`; на фронте — «100 AMD = ... ₽».
- [ ] Сеть в тестах запрещена (autouse-подмена `_http_get` бросает исключение); чистые тесты `test_home.py` проходят без БД.
- [ ] Главная: hero без изменений; «Мои инструменты» учитывает `module_access` (none скрыт, roadmap приглушён) и `module_badges`; больших карточек модулей нет.
- [ ] «Последние запуски» — только при `hasData`, без `NoDataAccess` на главной; ссылка «Все запуски» и `/core/runs` не изменены.
- [ ] Часы: 4 зоны, `HH:MM`, тик по границе минуты, таймеры очищаются.
- [ ] Погода/курсы: при ошибке или пустых данных — «Погода недоступна» / «Курсы недоступны», остальные блоки работают; атрибуция «Данные: MET Norway» видна всегда, когда показан прогноз.
- [ ] ДР/отпуска: под `viewer` блоков нет и запросов к `/modules/hr/*` с главной нет; под `employee` — есть; `kind` нигде не выводится; больничных нет (серверный фильтр не тронут).
- [ ] `frontend/src/core/**` не импортирует `modules/team/**` (проверить поиском); `HOME_WIDGETS` устроен по образцу `PROFILE_SECTIONS`.
- [ ] В JSX нет UI-литералов; новые строки — в `core/strings.js` (`hub.home`) и `team/strings.js` (`home`); удалённые `hub.modulesTitle/openTool/inDevelopment` нигде не используются.
- [ ] Адаптивность: от 1100px — две колонки (main 2fr / side 1fr), уже — одна; на 800px нет горизонтального скролла; используются существующие токены (`--red`, `--border`, `--muted`, `.mono`).
- [ ] Демо-режим (`VITE_DEMO_MODE=true`): главная заполнена под каждым демо-пользователем, в консоли нет ошибок.
- [ ] `npm test`, `npm run lint`, `npm run build`, `pytest` — зелёные.
- [ ] В конце `docs/TZ-home.md` есть раздел «Отступления реализации» (или явное «нет»).

---

## Отступления реализации
Решение пользователя по Q-H1: строки виджетов ДР/отпусков остаются в `modules/team/strings.js` (ключ `home`). Остальные открытые вопросы (Q-H2 … Q-H7) решены вариантом из ТЗ, без изменений: зеркало `cbr-xml-daily.ru`, User-Agent `TrendsetterHub/1.0 (+https://trendsettercrew.com)`, кэш в памяти одного процесса, `dismissed_at` не учитывается, иконок нет, города и валюты — константы (в коде стоят `TODO(Q-H2/H3/H4/H7)`).

Мелкие отклонения и уточнения:
1. Добавлен ключ `strings.hub.home.ratesHeading` («Курсы ЦБ РФ») — заголовок блока курсов, пока даты нет (загрузка/ошибка); в ТЗ перечислен только `ratesTitle(date)`.
2. `createHomeHandlers` в `mock/home.js` принимает `{ userFromToken, now }` и возвращает `{ handlers }` (как остальные фабрики mock); `now` — для тестов.
3. `home.py`: `_now()` возвращает `datetime` (UTC, aware), а не число; внутри время переводится в секунды. Для разбора ответа добавлены `parse_met`, `select_days`, `round_half_up`, `strip_symbol`, исключение `SourceError` (сбой источника по статусу; в лог пишется только имя типа).
4. Если у города есть данные, но они старше 24 ч, `stale` всегда `false` (данных нет). `updatedAt` равен `null`, когда `days` пуст.
5. Пустое состояние блока курсов («Курсы недоступны») показывается и при ошибке запроса, и при пустом списке `rates`. «Погода недоступна» — когда запрос упал или ни у одного города нет дней.
6. В `HubPage` у «Последних запусков» оставлен заголовок `h2` (раньше секция была отдельной); `NoDataAccess.jsx` не удалялся (файл вне ТЗ), на главной не используется. Неиспользуемое свойство `idx` в списке модулей и ключ `strings.moduleStatuses` оставлены (вне списка удаляемого в ТЗ).
7. Ручная проверка на 1440px/800px и демо-режима в браузере исполнителем не выполнялась (нет браузера): проверены линтер, сборка и тесты.
