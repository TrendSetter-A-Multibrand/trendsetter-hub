# ТЗ: пакет правок «Администрация» (часы, обратная связь, Администрация, календари) — релиз 0.0.2

Статус: lead, 2026-10-30, по `main` @ `5bf6eda` (прод v0.0.1). Ветка `admin-pack` (от `origin/main`). Открытые вопросы — `Q-AP*`, в коде — `TODO(Q-APn)`. Факты об `Intl` проверены (раздел «Проверка фактов»), отдельная проверка technical-analyst не нужна.

**Миграций нет ни в одном PR.** Бэкенд меняется только в PR 2 (необязательный параметр `kind` у `GET /modules/news/items`, обратно совместимо). Ревизия `0019` занята Андреем — её и модуль `analytics` не трогаем.

## Разбиение на PR (порядок обязателен)

| PR | Ветка | Пункты пользователя | Бэкенд |
|---|---|---|---|
| **PR 1 «Шапка и главная»** | `admin-pack` | 1, 2 (часы), 3, 4 (обратная связь в шапке, окно), 10 (запись 0.0.2) | нет |
| **PR 2 «Администрация»** | `admin-pack`, серия коммитов поверх PR 1 | 6, 7, 9 (+ дописать 0.0.2) | `kind` в `GET /modules/news/items` |
| **PR 3 «Персонал и Карта команды»** | `admin-pack`, серия коммитов поверх PR 2 | 8, 5 (+ дописать 0.0.2) | нет |

Как в `TZ-news-moderation.md`: три последовательные серии коммитов в одной ветке `admin-pack` (PR 2 зависит от PR 1, PR 3 — от механизма `redirect` из PR 2); приёмка ревьюером — после каждой серии. Выкат — одним релизом 0.0.2 (Q-AP8). Ничего не пушить и не коммитить без команды пользователя; ветку не ребейзить и не мержить `main`.

## Что уже есть в `main` (сверено, не делать заново)
- `modules/registry.js`: `MODULES` (у `news`, `holidays`, `feedback` — `hidden: (me) => …`, `forAll: true`, страница-раздел редактора/читателя), `PROFILE_SECTIONS`, `ONBOARDING_PROFILE_FORM`, `HOME_WIDGETS` (последняя строка — `feedback` → `HomeFeedbackCard`). Ни один модуль не импортирует `registry.js`; ядро импортирует только экспорты реестра.
- `core/access.js`: `isModuleHidden(module, me)`; `core/layout/moduleNumber.js` — номер считает все модули, кроме `hidden === true` (булев).
- `ModulePage.jsx`: `!module || hidden` → NotFound; `module_access[id] === 'none'` → Forbidden; компоненту передаются `{ module, access }`.
- `AppLayout.jsx`: меню из `MODULES`, бейдж — `me.module_badges[m.id]`; крошки; `wide`; в `topline-actions`: `VersionButton`, `NotificationsBell`, `ThemeToggle`, `DemoUserSwitcher`. На `<768px` тема в `topline` скрыта (есть в мобильной шапке).
- **Бэкенд проверяет id модулей по `MODULES` из `core/registry.py`** (`routes_admin.py:375`, неизвестный id → 422), а `GroupsTab`/`UserPermissionsModal` отправляют все id фронтового `MODULES`. Поэтому **новую строку в `MODULES` (фронт) для «Администрации» добавлять нельзя** — сломается сохранение прав.
- Часы: `core/home/clocks.js` (`CLOCK_ZONES`, `formatClock`), `myCity.js` (`CITY_ZONES` — 17 городов, `hub.myCity`, `clockZones` — правило Q-P2), `ClocksCard.jsx` (одна шестерёнка `CityPicker` на группе), `WeatherCard.jsx` (своя шестерёнка `CityPicker` — тот же «мой город»), `HubPage.jsx` держит `myCity`.
- Обратная связь: `FeedbackModal.jsx` (Switch «От чьего имени»), `lib/feedback.js` `buildPayload` уже обнуляет `contactOk` при анонимности; `FeedbackAdminSection.jsx` рисует `PageHead`; бэкенд шлёт уведомления со ссылкой `NOTIFY_LINK = "/modules/feedback"` (в БД уже лежат такие ссылки).
- Новости: `NewsAdminSection.jsx` (PageHead + «Добавить», «Срочная плашка», `HomeWidgetsEditor`, `.seg` статусов `review/current/past/drafts`, бейдж `me.module_badges.news`); `GET /modules/news/items?tab=` — **фильтра по `kind` нет**.
- Календарь: `HolidaysAdminSection.jsx` (PageHead + «Отметить дни»), `CalendarModal.jsx` (просмотр, `onClose`), `YearToolbar` принимает `children`.
- HR: `HrPage.jsx` — `TABS` с группами (`strings.groups`), `visible(me)`, бейджи по ключу, вход только при `access === 'run'`; модуль `hr` не `forAll`.
- Карта команды: `TeamHeader.jsx` — кнопка-переключатель `tm-leave-toggle` «Календарь отпусков» и группа `.tm-views` «Направления | Схема»; `TeamPage({ access })`.
- `widgetConfig.js`: неизвестные id в сохранённой настройке пропускаются — удаление виджета `feedback` безопасно без миграции.

## Сквозные решения (механизмы реестра)
Ядро по-прежнему не знает модулей: всё приходит через экспорты/поля реестра (как `PROFILE_SECTIONS`, `HOME_WIDGETS`).

1. **`TOPLINE_ACTIONS`** (PR 1) — новый экспорт реестра: `[{ id, visible(me), Component }]`, `Component` получает `{ me }`. `AppLayout` рисует видимые сразу **после `ThemeToggle`** (до `DemoUserSwitcher`) в `Suspense fallback={null}`.
2. **`OFFICE_SECTIONS` и страница ядра `/office`** (PR 2) — «Администрация» **не модуль** (не строка `MODULES`, нет id в бэкенде, нет в правах/группах). Экспорт реестра: `[{ id, label, visible(me), badge?(me), Component }]`. Ядро: маршрут `office`, `core/pages/OfficePage.jsx`, пункт меню в `AppLayout` (виден, если видна хоть одна вкладка), бейдж пункта = сумма `badge(me)` видимых вкладок. Отвергнутая альтернатива — «оболочка внутри `news`» (переименование `news.tool` всплывает в `UserPermissionsModal`, адрес `/modules/news?tab=holidays` путает).
3. **`redirect` у строки `MODULES`** (PR 2): `string` или `(me) => string | null`. `ModulePage` вычисляет его **первым** (до `hidden` и доступа); непустой → `<Navigate to replace />`; `null` → обычный путь. Нужен для старых адресов и ссылок из уведомлений.
4. **`menuBadge(me)` у строки `MODULES`** (PR 3): если задан — число у пункта меню берётся из него, иначе `me.module_badges[id]`.
5. **Слоты модулей через `module`-проп** (PR 3): строка `hr` получает `extraTabs`, строка `team` — `calendar`. Компоненты внедряются lazy в `registry.js` и приходят в страницу модуля пропом `module` от `ModulePage`. Модули `hr`/`team` **не импортируют** `feedback`/`holidays` и `registry.js`.

---

## PR 1 — «Шапка и главная» (пункты 1–4, 10)

### 1–2. Часы: два независимых блока, любой часовой пояс
**Решение (Q-AP2, Q-AP3):** часы и погода разводятся. Погода остаётся на «моём городе» (`hub.myCity`, 17 городов, шестерёнка в `WeatherCard` без изменений). Часы — два слота в `localStorage`: `hub.clock.1`, `hub.clock.2`, значение — **только IANA-зона** (строка). Пока слот не сохранён, он вычисляется по текущему правилу (у пользователей прода ничего не меняется):
- слот 1 по умолчанию: «мой город» (если выбран и не Ереван) — его зона и **его русское название** из `strings.hub.home.cities`; иначе `Asia/Yerevan` «Ереван»;
- слот 2 по умолчанию: `Europe/Moscow`, а если у **действующей зоны слота 1** сейчас то же время, что в Москве, — `Asia/Yerevan` (обобщение `clockZones`: сравнивается время, не id);
- `TODO(Q-AP3)` у функции: до первой ручной настройки часы следуют за «моим городом».

`core/home/clocks.js` — дописать чистые функции (без React; `Intl` и словарь подписей передаются параметром для тестов):
- `CLOCK_KEYS = ['hub.clock.1', 'hub.clock.2']`;
- `isValidZone(z)` — непустая строка и `new Intl.DateTimeFormat('en-US', { timeZone: z })` не бросает (**проверка по try/catch, не по вхождению в список**: `UTC`, `Etc/UTC` и устаревшие алиасы в список не входят);
- `browserZone(intl = Intl)` — `resolvedOptions().timeZone`, если валидна, иначе `null` (исключение → `null`);
- `allZones(extra = [], intl = Intl, names)` — `intl.supportedValuesOf?.('timeZone')`; нет функции → ключи словаря `names`; плюс `extra` (сохранённые/текущие зоны), без дублей;
- `zoneLabel(zone, names)` — `names[zone]` или последний сегмент IANA с `_` → пробел (`America/Sao_Paulo` → `Sao Paulo`);
- `zoneOffset(zone, now)` — `formatToParts` с `timeZoneName: 'shortOffset'` → `GMT+3`;
- `loadClockZone(storage, index)` → валидная сохранённая зона или `null` (мусор/ошибка хранилища → `null`); `saveClockZone(storage, index, zone)` (ошибка хранилища — тихо).

`core/home/myCity.js`: `clockZones(myCityId, now)` заменить на `clockSlots(myCityId, stored, now)` → `[{ timeZone, cityId }, { timeZone, cityId }]` (`cityId` — id из `CITY_ZONES`/`CLOCK_ZONES` для подписи по умолчанию, `null` у сохранённой зоны). `stored` — `[zone|null, zone|null]`. Без сохранённых результат совпадает с прежним `clockZones`.

`core/home/ZonePicker.jsx` (новый, по образцу `CityPicker`): шестерёнка (`city-gear` + переданный класс, `aria-label` «Настроить часы 01») → `Popover` (заголовок «Часы 01»/«Часы 02»): `Select showSearch` по `allZones`, подпись опции «название · GMT+3», поиск по подписи **и** IANA-id (свой `filterOption`), сортировка по подписи (`localeCompare` с локалью ru); под ним кнопка «Определить автоматически» (`browserZone()`; `null` → `disabled`). Выбор → `onChange(zone)`, Popover закрывается; Esc закрывает. Опции (≈400 вызовов `zoneOffset`) строить один раз на открытие (`useMemo`/ленивое состояние), не на каждый рендер.

`ClocksCard.jsx`: проп только `myCity` (без `onMyCity`); состояние `stored` из `loadClockZone` двух слотов; **шестерёнка в каждом блоке** (`hero-clock-gear`), `onChange` → `saveClockZone` + состояние. Подпись блока: `cityId ? s.cities[cityId] : zoneLabel(timeZone, s.zones)`. `key` блока — индекс (две одинаковые зоны допустимы). `HubPage.jsx`: `<ClocksCard myCity={myCity} />`. `CityPicker.jsx`: только комментарий «выбор для погоды» (логика не меняется).

`core/strings.js` (`hub.home`): `clockTitle(n)` → «Часы 01», `clockAria(n)` → «Настроить часы 01», `zonePlaceholder` «Найти город или часовой пояс», `zoneAuto` «Определить автоматически», `zones: { … }` — словарь IANA → русское название. Минимальный состав: зоны всех 17 городов и `CLOCK_ZONES`; плюс Europe/Kaliningrad, Europe/Samara, Europe/Volgograd, Asia/Omsk, Asia/Krasnoyarsk, Asia/Irkutsk, Asia/Yakutsk, Asia/Vladivostok, Asia/Magadan, Asia/Kamchatka, Europe/Kyiv и Europe/Kiev, Europe/Chisinau, Europe/Riga, Europe/Vilnius, Europe/Tallinn, Asia/Dushanbe, Asia/Ashgabat, Europe/London, Europe/Berlin, Europe/Rome, Europe/Madrid, Europe/Amsterdam, Europe/Prague, Europe/Warsaw, Europe/Vienna, Europe/Athens, Europe/Helsinki, Asia/Jerusalem, Asia/Tehran, Asia/Kolkata и Asia/Calcutta, Asia/Shanghai, Asia/Hong_Kong, Asia/Singapore, Asia/Bangkok, Asia/Tokyo, Asia/Seoul, Australia/Sydney, America/Chicago, America/Denver, America/Los_Angeles, America/Toronto, America/Mexico_City, America/Sao_Paulo, America/Argentina/Buenos_Aires, Africa/Cairo, UTC. Алиасы — оба ключа: список зон зависит от браузера.

`core/styles.css` (**только дописать в конец**): `.hero-clock { position: relative; }`, `.hero-clock-gear { position: absolute; top: var(--space-8); right: var(--space-8); }`; цвет: в `.hero-clock.prime` — `var(--accent-fill)`, во втором блоке — белый; у подписи блока отступ справа под шестерёнку. Старое правило `.hero-clocks-gear` не удалять (станет неиспользуемым — записать в «Отступления»).

### 3. Кнопка «Обратная связь» в верхней строке
- `registry.js`: удалить строку `feedback` из `HOME_WIDGETS`; добавить `export const TOPLINE_ACTIONS = [{ id: 'feedback', visible: canSendFeedback, Component: lazy(() => import('./feedback/components/FeedbackButton.jsx')) }]` с комментарием-контрактом.
- `modules/feedback/components/FeedbackButton.jsx` (новый): `<button type="button" className="topline-btn">` с подписью «Обратная связь» + `FeedbackModal` по клику (`onSent`/`onClose` закрывают).
- `AppLayout.jsx`: вывести видимые `TOPLINE_ACTIONS` после `<ThemeToggle />`.
- `core/styles.css` (дописать): `.topline-btn` — вид как у `.version-btn` (моно-подпись, рамка, hover); на `<768px` кнопка видна, на 375px `topline-actions` не переполняется (перенос допустим).
- Удалить `HomeFeedbackCard.jsx`, блок `home` в `feedback/strings.js`, правило `.fb-card-action` в `feedback.css` (осиротели). Сохранённая настройка виджетов с id `feedback` игнорируется (`widgetConfig.js`); при следующем сохранении редактором id исчезнет.

### 4. Окно обратной связи
- `FeedbackModal.jsx`: убрать поле «От чьего имени» и `Switch`. Вместо него — `Checkbox` «Анонимно» (по умолчанию снят; при включении `contactOk = false`). Не анонимно: строка «От: ФИО» (`me.full_name` через `useAuth`), чекбокс «Разрешаю HR связаться со мной» и подсказка `namedHint`. Анонимно: только предупреждение `anonymousWarning`. Порядок: тип → адресат → сообщение → «Анонимно» → (От/контакт/подсказка | предупреждение).
- `feedback/strings.js`: удалить `authorLabel`, `named`; добавить `from(name)` → «От: ФИО». `lib/feedback.js` не меняется.

### 10. `core/changelog.js`
Новый первый элемент `{ version: '0.0.2', date: 'ДД.ММ.ГГГГ выката', added, changed, fixed: [] }` — пункты PR 1:
- added: «Часы на главной: любой город мира в каждом из двух блоков и «Определить автоматически»», «Кнопка «Обратная связь» в верхней строке»;
- changed: «Окно обратной связи: одна галочка «Анонимно»», «Часы и погода настраиваются отдельно».
PR 2 и PR 3 дописывают свои пункты в тот же элемент (Q-AP8).

### Тесты PR 1 (`npm test`)
- `clocks.test.js`: `isValidZone` (`Europe/Moscow`, `UTC`, `Etc/UTC` — да; пустая строка, `Mars/Base`, `null` — нет); `browserZone` с подменённым `intl` (валидная, невалидная, исключение → `null`); `allZones` без `supportedValuesOf` → словарь + extra без дублей; с ним — список + extra; `zoneLabel` (словарь, `America/Sao_Paulo` → `Sao Paulo`); `zoneOffset` для `Asia/Yerevan` → `GMT+4`; `load/saveClockZone` с fakeStorage (мусор, невалидная зона, бросающее хранилище).
- `myCity.test.js`: прежние кейсы `clockZones` переписать на `clockSlots(id, [null, null], NOW)` с теми же ожидаемыми зонами; новые: сохранённый слот 1 = `Europe/Moscow` → слот 2 по умолчанию `Asia/Yerevan`; сохранённый слот 2 не зависит от «моего города»; `cityId === null` у сохранённой зоны.
- `changelog.test.js` проходит без правок.

### Файлы PR 1
`frontend/src/core/home/{clocks.js, clocks.test.js, myCity.js, myCity.test.js, ClocksCard.jsx, ZonePicker.jsx (новый), CityPicker.jsx (комментарий)}`, `frontend/src/core/pages/HubPage.jsx`, `frontend/src/core/layout/AppLayout.jsx`, `frontend/src/core/strings.js`, `frontend/src/core/styles.css` (дописать), `frontend/src/core/changelog.js`, `frontend/src/modules/registry.js`, `frontend/src/modules/feedback/{components/FeedbackModal.jsx, components/FeedbackButton.jsx (новый), components/HomeFeedbackCard.jsx (удалить), strings.js, feedback.css}`.

---

## PR 2 — «Администрация» (пункты 6, 7, 9)

### 6. Раздел меню «Администрация»
- `core/strings.js`: `office: { title: 'Администрация', dept: 'Компания', tabsLabel: 'Разделы администрации' }` (рабочее название, Q-AP1).
- `registry.js`:
  - `export const OFFICE_SECTIONS = [ { id: 'news', label: newsStrings.office.tab, visible: isNewsEditor, badge: (me) => me.module_badges?.news ?? 0, Component: lazy(() => import('./news/NewsAdminSection.jsx')) }, { id: 'holidays', label: holidaysStrings.tool, visible: isHolidaysEditor, Component: lazy(() => import('./holidays/HolidaysAdminSection.jsx')) } ]` + комментарий-контракт (как у `PROFILE_SECTIONS`). Порядок вкладок = порядок здесь.
  - строки `news` и `holidays` в `MODULES`: `hidden: true`, `Component: null`, `redirect: '/office?tab=news'` / `'/office?tab=holidays'`; комментарии обновить. Номера остальных пунктов меню не сдвигаются (обе строки в конце).
- `core/access.js`: `resolveRedirect(module, me)` → строка или `null` (поле-функция/строка/нет поля). `ModulePage.jsx` вызывает его первым и делает `<Navigate replace />`.
- `core/AppRoutes.jsx`: `<Route path="office" element={<OfficePage />} />` внутри `AppLayout`.
- `core/pages/OfficePage.jsx` (новый): `PageHead` с `eyebrow={strings.office.dept}` и `title={strings.office.title}`; видимые вкладки = `OFFICE_SECTIONS.filter((x) => x.visible(me))`; нет видимых → `NotFoundPage`; `?tab=` (неизвестный → первая видимая; выбор → `setParams({ tab }, { replace: true })`); переключатель — `.seg` V1 (`aria-pressed`, `aria-label={strings.office.tabsLabel}`), у вкладки с `badge(me) > 0` — `nav-badge`; активная — `<Suspense><Component me={me} /></Suspense>` с `key={id}`.
- `AppLayout.jsx`: после модулей — пункт-ссылка на `/office` (`nav-num` «—», `NavTitle` = `office.title`, `nav-dept` = `office.dept`); виден, если есть видимые вкладки и совпадает поиск (по названию, отделу, подписям вкладок); бейдж = сумма `badge(me)` видимых вкладок; `active` на `/office`; крошки для `/office`: Хаб / Администрация / подпись вкладки; `wide` для `/office`.
- `NewsAdminSection.jsx`, `HolidaysAdminSection.jsx`: убрать `PageHead` и проп `module`. «Отметить дни» — в `children` у `YearToolbar`.
- Бейдж «на проверке» — на пункте «Администрация» (сумма) и на кнопке статуса «На проверке»; `refreshMe()` после действий уже есть.

### 7. Вкладка «Новости»: три колонки
**Решение (Q-AP7):** один общий `.seg` статусов (На проверке [бейдж] / Актуальное / Прошедшие и архив / Черновики) над колонками «Новости» и «События»; каждая колонка грузит свой список `tab + kind` и листается своей пагинацией; колонка «Виджеты» от статуса не зависит.
- Бэкенд `backend/app/modules/news/router.py`: в `list_items` параметр `kind: Literal["news", "event"] | None = None`; `service.list_items(session, user, tab, limit, offset, kind=None)`: при `kind` — `where = f"({where}) AND kind = :kind"` (**скобки обязательны**: в условиях `past` и `current` есть `OR`), параметр `kind` в обоих запросах (count и rows). Без `kind` — поведение прежнее.
- Mock `core/api/mock/news.js`: тот же фильтр, неизвестный `kind` → 422.
- Фронт: `modules/news/components/NewsColumn.jsx` (новый) — пропы `{ kind, tab, version, onEdit, onReview, onResponses, onChanged }`, своя страница (сброс при смене `tab` — через `key`), запрос `?tab=&kind=&limit=&offset=`; `ItemRow` и `moveFor` переносятся из `NewsAdminSection` без изменения поведения. Порядок закреплённых — внутри колонки (один `kind`).
- `NewsAdminSection.jsx`: сверху `.seg` статусов; сетка `.news-cols`:
  1. «Новости»: **сначала «Срочная плашка»** (`BannerEditor`, всегда, при любом статусе), затем `SectionHead` «Новости» с кнопкой «+ Новость» и `NewsColumn kind="news"`;
  2. «События»: `SectionHead` «События» с кнопкой «+ Событие» и `NewsColumn kind="event"`;
  3. «Виджеты»: `HomeWidgetsEditor`.
  Кнопка «Добавить» из шапки удаляется. `NewsEditorDrawer` — новый необязательный проп `defaultKind` (только при `item === null`), выбор типа в форме остаётся.
- `news.css` (модульный, править можно): `.news-cols { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr) minmax(280px,340px); gap: var(--space-40); align-items: start; }`; `<1200px` — две колонки, «Виджеты» на всю ширину (`grid-column: 1 / -1`); `<768px` — одна колонка.
- `news/strings.js`: `office.tab` «Новости», `admin.columns: { news: 'Новости', events: 'События' }`, `admin.addNews` «+ Новость», `admin.addEvent` «+ Событие». `tool` («Редактор новостей») не трогать — он подпись в окне прав.

### 9. Баг: в «Виджетах главной» не видны переключатели и стрелки
Статически причина **не подтверждена**: в собранном CSS (`vite build` @ `5bf6eda`) нет правил, скрывающих `.ant-switch`/`.ant-btn` или режущих `.people-row`; разметка рисует `Switch` и обе кнопки безусловно. Порядок работы:
1. Воспроизвести: `npm run build && npm run preview` (демо, редактор новостей — пользователь 9), светлая и тёмная темы, ширина 1440/1024/375; в DevTools: элементы есть в DOM? размеры, цвет, `overflow`? Сверить хеш ассетов на проде с `main` (возможен устаревший бандл/кеш).
2. Гипотезы (проверить по порядку, не выдавать за факт): H1 — контраст в тёмной теме (`Switch` с `handleBg: c.page`, кнопки с прозрачным фоном); H2 — строка шире контейнера (`.widget-label { flex: 1 }`) и элементы уходят за край; H3 — устаревший бандл на проде; H4 — скриншот с другого экрана (Q-AP9 — уточнить у пользователя адрес, тему, браузер).
3. Независимо от причины — новая разметка строки в `HomeWidgetsEditor.jsx`: `div.widget-row` **без** `people-row`; в `news.css` правила `.widget-row` и `.widget-row.people-row` заменить на `.widget-row { display: grid; grid-template-columns: minmax(0,1fr) auto auto auto; align-items: center; gap: var(--space-8); min-height: 44px; border-bottom: 1px solid var(--border-default); }`. Если подтвердится H1 — явные цвета токенами для `.widget-row .ant-switch` и `.widget-row .ant-btn` в `news.css`.
4. Причину записать в «Отступления реализации» этого файла.

### changelog (дописать в 0.0.2)
- added: «Раздел «Администрация»: новости, события, виджеты главной и производственный календарь»;
- changed: «Пункты меню «Редактор новостей» и «Производственный календарь» объединены в «Администрацию»», «Редактор новостей: колонки «Новости», «События», «Виджеты»»;
- fixed: «В настройке виджетов главной видны переключатели и стрелки порядка».

### Тесты PR 2
- `backend/tests/test_news.py`: `kind=news`/`kind=event` для всех четырёх `tab` возвращают только свой тип, `total` = число записей своего типа; `past` + `kind=news` не возвращает отклонённое **событие** (проверка скобок); неизвестный `kind` → 422; без `kind` — существующие тесты зелёные.
- `core/api/mock/news.test.js`: то же для mock.
- `core/access.test.js`: `resolveRedirect` — нет поля → `null`; строка → строка; функция → строка/`null`.
- `pytest`, `npm test`, `npm run lint`, `npm run build`.

**Порядок выката:** бэкенд с `kind` — раньше фронтенда PR 2 или вместе. FastAPI молча игнорирует неизвестный параметр: старый бэкенд отдаст обеим колонкам один смешанный список без ошибки. Демо (Vercel) закрыто mock.

### Файлы PR 2
`backend/app/modules/news/{router.py, service.py}`, `backend/tests/test_news.py`, `frontend/src/core/{AppRoutes.jsx, access.js, access.test.js, strings.js, changelog.js}`, `frontend/src/core/pages/{ModulePage.jsx, OfficePage.jsx (новый)}`, `frontend/src/core/layout/AppLayout.jsx`, `frontend/src/core/api/mock/{news.js, news.test.js}`, `frontend/src/modules/registry.js`, `frontend/src/modules/news/{NewsAdminSection.jsx, strings.js, news.css, components/NewsColumn.jsx (новый), components/HomeWidgetsEditor.jsx, components/NewsEditorDrawer.jsx}`, `frontend/src/modules/holidays/HolidaysAdminSection.jsx`.

---

## PR 3 — «Персонал и Карта команды» (пункты 8, 5)

### 8. «Обратная связь» — вкладка в «Персонале»
**Риск:** `HrPage` пускает только при `access === 'run'` на `hr`, а `hr` не `forAll`. «Ответственный» за feedback вне HR-отдела потерял бы доступ к сообщениям. **Решение (Q-AP5):** у таких читателей остаётся прежний пункт меню «Обратная связь».
- `registry.js`: `const hrRun = (me) => me.module_access?.hr === 'run'`.
  - строка `feedback`: `hidden: (me) => !isFeedbackReader(me) || hrRun(me)`, `redirect: (me) => (isFeedbackReader(me) && hrRun(me) ? '/modules/hr?tab=feedback' : null)`, `TODO(Q-AP5)`. Старые ссылки уведомлений `/modules/feedback` ведут во вкладку; бэкенд `NOTIFY_LINK` не меняем.
  - строка `hr`: `extraTabs: [{ key: 'feedback', group: 'feedback', groupLabel: feedbackStrings.hr.group, label: feedbackStrings.hr.tab, visible: isFeedbackReader, badge: (me) => me.module_badges?.feedback ?? 0, Component: lazy(() => import('./feedback/FeedbackAdminSection.jsx')) }]` и `menuBadge: (me) => (me.module_badges?.hr ?? 0) + (isFeedbackReader(me) && hrRun(me) ? (me.module_badges?.feedback ?? 0) : 0)` (без `hrRun` число задвоилось бы: у читателя без HR остаётся свой пункт «Обратная связь», а «Персонал» виден приглушённым).
- `AppLayout.jsx`: `const badge = m.menuBadge ? m.menuBadge(me) : (me.module_badges?.[m.id] ?? 0)`.
- `modules/hr/lib/tabs.js` (новый, чистая функция) `mergeTabs(base, extra)` — вставляет `extra` **перед первой вкладкой группы `security`** (Журнал); нет такой группы — в конец. `HrPage.jsx`: `mergeTabs(TABS, module.extraTabs ?? [])`, затем фильтр `visible`; подпись группы `strings.groups[g.key] ?? g.items[0].groupLabel`; число у вкладки: `badge` — функция → `t.badge(me)`, строка → `badges[t.badge]`, нет → 0.
- `FeedbackAdminSection.jsx`: `PageHead` только если передан `module` (во вкладке HR его нет; на запасной странице `/modules/feedback` — есть).
- `feedback/strings.js`: `hr: { group: 'Обратная связь', tab: 'Сообщения' }` (Q-AP10).

### 5. Производственный календарь в «Карте команды»
**Решение (Q-AP6):** не новый вид карты, а кнопка, открывающая существующий `CalendarModal`; визуально — сегментная группа рядом с «Направления | Схема».
- `registry.js`, строка `team`: `calendar: { visible: canReadHolidays, label: holidaysStrings.title, Component: lazy(() => import('./holidays/components/CalendarModal.jsx')) }`.
- `TeamPage.jsx`: принимает `module`; `calendar = module.calendar?.visible(me) ? module.calendar : null` (`me` из `useAuth`); состояние «открыт календарь»; модалка в `Suspense fallback={null}` с `onClose`.
- `TeamHeader.jsx`: кнопку `tm-leave-toggle` заменить группой `div.tm-views.tm-cals` (`role="group"`, `aria-label={s.calendarsLabel}`): «Календарь отпусков» (`aria-pressed`, прежняя логика, только при `canLeave`) и подпись `calendar.label` (обычная кнопка без `aria-pressed`, открывает модалку, только при `calendar`). Нет ни одной кнопки — группы нет. Порядок в строке: календари, «Направления | Схема», чипы.
- `team/strings.js`: `header.calendarsLabel` «Календари». `team.css` (модульный): удалить правила `.tm-leave-toggle*` (осиротели), дописать `.tm-cals { margin-right: 10px; }`.

### changelog (дописать в 0.0.2)
- added: «Производственный календарь в «Карте команды»»;
- changed: «Обратная связь — вкладка в «Персонале»».

### Тесты PR 3
- `modules/hr/lib/tabs.test.js`: вставка перед `security`; без `security` — в конец; пустой `extra` — без изменений; порядок внутри `extra` сохраняется.
- `npm test`, `npm run lint`, `npm run build`.

### Файлы PR 3
`frontend/src/modules/registry.js`, `frontend/src/core/layout/AppLayout.jsx`, `frontend/src/core/changelog.js`, `frontend/src/modules/hr/{HrPage.jsx, lib/tabs.js (новый), lib/tabs.test.js (новый)}`, `frontend/src/modules/feedback/{FeedbackAdminSection.jsx, strings.js}`, `frontend/src/modules/team/{TeamPage.jsx, components/TeamHeader.jsx, strings.js, team.css}`.

---

## Не трогать (все PR)
- `modules/analytics` и всё по аналитике Андрея, ревизию `0019`; `backend/alembic`, `db/`, `deploy/`.
- `backend/app/core/registry.py`, права/группы, `NOTIFY_LINK` в feedback.
- Существующие правила `core/styles.css` (только дописывать в конец), `vite.config.js`, `ARCHITECTURE.md`, `CLAUDE.md`.
- `useHomeWeather`, `WeatherCard`, `CITY_ZONES`, бэкенд погоды; `lib/feedback.js`, `CalendarModal.jsx`, `YearCalendar.jsx`.
- Репозиторий purchasing_dashboard. Новых зависимостей не добавлять.

## Проверка фактов (Node 24, 2026-10-30)
- T-AP1: `Intl.supportedValuesOf('timeZone')` — 418 зон; `UTC` в списке **нет**, но валидна; в Node — устаревшие имена (`Europe/Kiev`, `Asia/Calcutta`), в браузерах может быть иначе → словарь с обоими ключами, валидность — через try/catch.
- T-AP2: `timeZoneName: 'longGeneric'` в ru-RU даёт не город («Москва, стандартное время», «Восточная Америка», «Индия») → для подписей не годится; `shortOffset` даёт `GMT+3`, `GMT+5:30` — используем для смещения.
- T-AP3: невалидная зона → `RangeError`.
- T-AP4: `vite build` @ `5bf6eda` — в CSS нет правил, скрывающих переключатели/кнопки `HomeWidgetsEditor` (см. п. 9).

## Открытые вопросы (закрыты рекомендациями; меняется одной строкой или правилом)
- **Q-AP1** «Администрация» в меню рядом с «Администрированием» в профиле (управление пользователями) — возможна путаница. Рек.: оставить; название — одна строка `strings.office.title`.
- **Q-AP2** Сохранённые часы хранят только зону: «Казань» после ручного выбора станет «Москва». Рек.: принять.
- **Q-AP3** До первой ручной настройки часы следуют за «моим городом» (погодой). Рек.: принять — у прода вид не меняется.
- **Q-AP4** Номер пункта «Администрация» — «—» (это не отдел). Рек.: «—».
- **Q-AP5** Читатель обратной связи без доступа `run` к HR сохраняет старый пункт меню. Рек.: принять; иначе ему нужен доступ к HR.
- **Q-AP6** Производственный календарь в карте — модальное окно, а не вид карты. Рек.: модалка.
- **Q-AP7** Статусы — один общий переключатель для колонок «Новости»/«События», у каждой своя пагинация. Рек.: принять.
- **Q-AP8** Версия: три серии в одной ветке выкатываются вместе — один релиз 0.0.2 (PR 2 и PR 3 дописывают тот же элемент). Если пользователь решит выкатывать по частям — PR 2 и PR 3 создают 0.0.3 и 0.0.4. Рек.: выкатить вместе.
- **Q-AP9** Причина бага с виджетами статически не найдена — нужны адрес, тема, браузер со скриншота.
- **Q-AP10** Подписи в HR: группа «Обратная связь», вкладка «Сообщения». Рек.: принять.

## План
1. PR 1: часы (`clocks.js`, `myCity.js`, `ZonePicker`, `ClocksCard`) → проверка: `npm test`; шестерёнка в каждом блоке; без сохранённых слотов — как в v0.0.1.
2. PR 1: `TOPLINE_ACTIONS` + `FeedbackButton`, удаление виджета → проверка: кнопка правее темы; на главной нет карточки.
3. PR 1: `FeedbackModal` (галочка «Анонимно») + запись 0.0.2 → проверка: тело запроса, `changelog.test.js`.
4. PR 2: бэкенд `kind` + mock + тесты → проверка: `pytest tests/test_news.py`, `npm test`.
5. PR 2: `resolveRedirect`, `OFFICE_SECTIONS`, `OfficePage`, меню/крошки/бейдж → проверка: `/modules/news` → `/office?tab=news`.
6. PR 2: колонки новостей и исправление виджетов → проверка: preview prod-сборки, обе темы, 1440/1024/375.
7. PR 3: `extraTabs`/`mergeTabs`/`menuBadge`, `redirect` у feedback → проверка: вкладка перед «Журналом», ссылка из уведомления.
8. PR 3: календарь в карте → проверка: кнопка у сотрудника, нет у viewer.

## ТЗ для исполнителя
- Делать строго по разделам PR в указанном порядке, каждый PR — отдельной серией коммитов в ветке `admin-pack`; трогать только файлы из «Файлы PR N». Нужен файл вне списка — остановиться и вернуть открытый вопрос.
- Все UI-строки — в `core/strings.js` (ядро) или `modules/<id>/strings.js`. Ядро не импортирует модули (только `registry.js`); модули не импортируют друг друга и `registry.js`.
- Дизайн V1: `PageHead`, `SectionHead`, `.seg`, токены; в `core/styles.css` только дописывать в конец.
- Миграций и изменений БД нет. Бэкенд — только `kind` в PR 2.
- Решения из «Открытых вопросов» реализовать как рекомендовано, `TODO(Q-APn)` поставить: Q-AP3 — `clockSlots`; Q-AP5 — строка `feedback` в реестре; Q-AP7 — `NewsAdminSection`; Q-AP2 — `saveClockZone`.
- Пункт 9: сначала воспроизвести и записать причину, потом чинить.
- После каждого PR: `npm test`, `npm run lint`, `npm run build` (PR 2 ещё `pytest`). Отступления — в раздел «Отступления реализации» в конце этого файла.

## Критерии приёмки для ревьюера
**PR 1**
- На главной две шестерёнки — у каждого блока часов; выбор в блоке 01 не меняет блок 02 и погоду; смена города погоды не меняет вручную настроенные часы.
- Без `hub.clock.*` часы совпадают с v0.0.1 при любом «моём городе» (тесты `clockSlots` = прежние ожидания `clockZones`).
- В списке поясов — все пояса браузера (≈400); поиск «Нью» находит Нью-Йорк, `Tokyo` — Токио; у опции есть смещение `GMT±`.
- «Определить автоматически» ставит зону браузера; при невалидной кнопка недоступна; мусор в `localStorage` не ломает главную.
- «Обратная связь» в верхней строке правее переключателя темы, открывает окно; у viewer кнопки нет; на 375px строка не переполнена; на главной карточки нет; сохранённая настройка с `feedback` ошибок не даёт.
- Окно: нет «От чьего имени» и `Switch`; «Анонимно» снята по умолчанию; «Разрешаю HR связаться» видна только без анонимности; анонимная отправка шлёт `contactOk: false`.
- `CHANGELOG[0].version === '0.0.2'`, дата в формате ДД.ММ.ГГГГ, `changelog.test.js` зелёный.
- В `core/` нет импортов `modules/feedback` (кроме через `registry.js`).

**PR 2**
- В меню нет «Редактор новостей» и «Производственный календарь»; есть «Администрация» — только у ответственного за news или holidays и у admin; у ответственного только за календарь — одна вкладка.
- `/modules/news` и `/modules/holidays` → `/office?tab=…`; неизвестный `?tab` → первая видимая; без прав `/office` → «Не найдено».
- Бейдж «на проверке» — на пункте «Администрация» и на кнопке «На проверке»; после одобрения уменьшается без перезагрузки.
- Окно прав пользователя и группы: список модулей не изменился, сохранение прав работает (нет 422).
- Вкладка «Новости»: три колонки; плашка — сверху колонки «Новости»; статус переключает обе колонки; в каждой колонке только свой тип и своя пагинация; порядок закреплённых работает в «Актуальном»; на <1200px и <768px колонки перестраиваются.
- `GET /modules/news/items` без `kind` — как раньше; `kind` фильтрует; неизвестный `kind` → 422; тест на скобки есть.
- Виджеты главной: в prod-сборке (`npm run build && npm run preview`) в светлой и тёмной теме у каждой строки виден и работает переключатель и обе стрелки, в т. ч. в узкой колонке; причина записана в «Отступлениях».
- Вкладка «Производственный календарь» работает как прежний раздел («Отметить дни», клик по дню, правка, удаление).

**PR 3**
- В «Персонале» вкладка «Сообщения» (группа «Обратная связь») стоит перед «Журналом», видна только читателю обратной связи.
- Читатель с `run` на HR: пункта «Обратная связь» в меню нет; `/modules/feedback` → `/modules/hr?tab=feedback`; число новых сообщений — на «Персонале» и на вкладке, уменьшается после разбора. Читатель без HR: прежний пункт работает, число новых сообщений — только на «Обратной связи», на «Персонале» его нет.
- `modules/hr` и `modules/team` не импортируют `modules/feedback`, `modules/holidays` и `registry.js`.
- «Карта команды»: группа «Календарь отпусков | Производственный календарь»; первая переключает вид как раньше, вторая открывает календарь за год; у viewer группы нет.
- Во всех PR: `npm test`, `npm run lint`, `npm run build` зелёные; `analytics`, миграции, `db/` не тронуты.

## Отступления реализации
(заполняет исполнитель)

**PR 2**
- **Причина бага п. 9 (воспроизведение).** Prod-сборка (`vite build` с `VITE_DEMO_MODE=true` + `vite preview`) на коммите e99833e, редактор новостей (пользователь 9), Chrome headless, светлая и тёмная темы, 1440/1024/375: `Switch` и обе кнопки есть в DOM, `display`/`visibility`/`opacity` в норме, все элементы строки внутри окна (на 375px: label 16-200, Switch 212-256, кнопки 268-300 и 312-344; горизонтальной прокрутки нет), контраст в обеих темах достаточный, неактивные крайние стрелки видны серой плашкой. H1 (контраст) и H2 (выход за край) не подтверждены; воспроизвести дефект не удалось. Остаются H3 (устаревший бандл/кеш на проде) и H4 (другой экран/браузер) — Q-AP9 открыт. Наблюдение: на широком экране элементы управления стоят у правого края строки (~900px от подписи) и легко теряются; в новой раскладке («Виджеты» — узкая колонка 280-340px) этого нет. Исправление сделано по п. 3 ТЗ (`div.widget-row` без `people-row`, grid), цвета `.ant-switch`/`.ant-btn` не менялись (H1 не подтвердилась).
- Номер пункта меню «Обратная связь» сдвинулся (09 -> 07): `moduleNumber` не считает строки с `hidden === true`, а `news` и `holidays` теперь скрыты булевым флагом. Номера остальных пунктов не изменились.
- `core/styles.css`: дописано правило `.office-tab-badge` (ТЗ не перечисляет файл; нужно, потому что `news.css` грузится лениво и отступ числа на вкладке иначе появляется с задержкой).
- Моб. 375px: переключатель статусов в «Новостях» (4 кнопки) шире экрана и прокручивается внутри себя.
- Дописано (вне списка PR 2 по ТЗ): `popupMatchSelectWidth={false}` у `Select` в `ZonePicker.jsx` (мелочь из PR 1 по просьбе заказчика).
