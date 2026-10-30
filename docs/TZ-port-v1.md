# ТЗ: перенос нашей работы на «Дизайн V1» и рестайл наших экранов

Ред. 1, 2026-10-29. Автор плана: lead. Код не написан, ветки не трогались.

## 0. Исходное состояние (проверено)

- В `origin/main` влит «Дизайн V1» Дианы (PR #42, `c30b245`, merge `04cd6fe`). `git diff 798e8d0 origin/main` затрагивает **только фронтенд** (43 файла): бэкенда, `db/` и миграций в нём нет. Последняя ревизия в main — `0013_wb_marking_imported`.
- Наша цепочка поверх `798e8d0` линейная и есть только локально (на origin этих веток нет, поэтому force-push не понадобится):
  `news-moderation` (`50d46a0`: 0014, 0015) → `holidays` (`44c5b44`: 0016) → `onboarding` (`0d9d503`: 0017) → `feedback` (`deb4ec4`: 0018).
  `home-weather-2days` (`14621d2`) — отдельная ветка от `798e8d0`, один коммит.
- Конфликты при переносе дают только 3 коммита: `0569e99` (новости PR1), `50d46a0` (виджеты), `d4590ef` (онбординг PR2). Файлы: `AppLayout.jsx`, `DemoUserSwitcher.jsx`, `HubPage.jsx`, `LoginPage.jsx`, `news/components/HomeNewsFeed.jsx`, `news/lib/news.js`.
- **Скрытые конфликты, которых git не покажет:**
  1. `core/layout/moduleNumber.js` (V1) считает видимыми модули по `!m.hidden`. У нас `hidden` бывает функцией `(me) => bool`, а функция всегда truthy. В итоге у news/holidays/feedback номер `null`, а в меню после нашей замены на `isModuleHidden` номер другой.
  2. V1 удалил классы `.home-card`, `.home-card-head`, `.home-panel`, `.news-col-title`, `.greeting`, `.home-layout`, `.home-col`, `.home-aside`. Их используют наши `HomeHolidays.jsx` и `HomeFeedbackCard.jsx`, а также старые `HubPage`/`HomeNewsFeed`. После слияния эти блоки останутся без стилей.
  3. V1 перевёл все `--radius-*` в 0 и переопределил `--zone-*` нейтральными. Наши `holidays.css`, `feedback.css` и `news.css` используют только существующие токены (`--row-accent` — локальная переменная `news.css`), так что сборка не ломается. Ломается только вид.
- Ветка `home-weather-2days` меняет **контракт** `/core/home/weather`: вместо `{source, cities[]}` там `{source, locations, city:{today,tomorrow}}`, а WeatherCard Дианы читает `cities[].days[]`. Поэтому эту ветку **не переносим ни rebase, ни cherry-pick**. Из неё вручную берутся только отдельные функции (этап 6).

## 1. Способ переноса и его обоснование

**Рекомендация:** один `rebase --update-refs` вершины цепочки, затем рестайл отдельными коммитами на каждой ветке по очереди и повторный `rebase --update-refs` хвоста.

Почему так:
- Цепочка линейная. `git rebase --update-refs --onto origin/main 798e8d0` из `feedback` переносит все 4 ветки сразу и сам переставляет ссылки `news-moderation`, `holidays`, `onboarding`. Каждый конфликт решается один раз, всего три остановки.
- Merge `origin/main` в каждую ветку дал бы merge-коммиты в каждом PR и повторное решение одних и тех же конфликтов.
- Squash потерял бы историю PR1/PR2, на которую ссылаются ТЗ и `db/README.md`.
- Ветки не опубликованы, поэтому переписывание истории никому не мешает.

Раздельный «механический перенос» и «рестайл» для `HubPage`/`HomeNewsFeed` невозможен: при конфликте раскладку приходится решать сразу. Поэтому целевое содержимое конфликтных файлов задано в этапе 1, и исполнитель вписывает его при разрешении конфликта.

Номера миграций **0014–0018 сохраняются**: в main последняя 0013, новых ревизий V1 не добавил. `down_revision` у 0014 остаётся `'0013'`. Риск: неопубликованная ветка Андрея (аналитика) тоже может занять 0014 (Q-P4).

## 2. Решения по спорным местам (рекомендации, утверждает пользователь)

| # | Вопрос | Рекомендация | Альтернатива |
|---|---|---|---|
| Q-P1 | Один «Мой город» для часов и погоды или два разных | **Один** (`localStorage` ключ `hub.myCity`). Обе шестерёнки открывают один и тот же выбор | Раздельные ключи часов и погоды |
| Q-P2 | Часы с выбранным городом | **Остаётся 2 блока.** Слот 01 (белый, prime) = мой город. Слот 02 = Москва, а если время моего города сейчас совпадает с московским (Москва, Казань, Минск, Стамбул…), то Ереван. Сравнивается текущее время, а не id зоны. Без выбора всё как сейчас: 01 Ереван, 02 Москва | Третьи часы. Отклонено: `.hero-clocks` — колонка-сетка, третий блок удлинит красную шапку, а справа стоит отступ 168px под маскота |
| Q-P3 | По какому городу подсказка под приветствием | **По активной кнопке переключателя погоды.** По умолчанию активен мой город, если выбран, иначе первый (Ереван) | Всегда по «моему городу» |
| Q-P4 | Номера миграций и ветка Андрея | Мы держим 0014–0018, Андрей начинает с 0019. Сообщить ему до его PR | Если он вольётся раньше с 0014, перенумеровать наши 5 ревизий (`revision`/`down_revision`, имена файлов, `test_database`, stamp-скрипты) |
| Q-P5 | Что настраивается в «Виджетах главной» | **Только блоки модулей без `slot`** во втором ряду справа под курсами: дни рождения, отпуска, праздники, обратная связь (порядок и включение). Часы (в шапке), погода и курсы закреплены по раскладке Дианы | Сделать настраиваемыми и погоду/курсы. Отклонено: меняет раскладку Дианы |
| Q-P6 | Нумерация модулей в меню и в PageHead | Номер = позиция среди модулей, у которых `hidden !== true` (одинаков у всех пользователей). Наши модули со скрытием по `me` стоят в конце `MODULES`: news 07, holidays 08, feedback 09. Номера модулей Дианы не меняются | Номер по факту видимости у конкретного пользователя. Отклонено: у одного модуля будут разные номера у разных людей |

Пока пользователь не ответит, исполнитель реализует рекомендацию и ставит `TODO(Q-Pn)` в месте решения.

---

## План

0. **Подготовка.** Бэкап-теги, проверка базы.
   → проверка: 5 тегов `backup/*-pre-v1`; `git log -1 origin/main` = `04cd6fe`.
1. **Перенос цепочки** одним `rebase --update-refs`, конфликты решаются по целевому содержимому (этап 1).
   → проверка: `origin/main` — предок всех 4 веток; pytest, `npm test`, lint и build зелёные **на каждой из 4 вершин**.
2. **Рестайл news-moderation** (коммиты на `news-moderation`), затем `rebase --update-refs` хвоста.
   → проверка: гейты на 4 вершинах, демо в двух темах.
3. **Рестайл holidays** (на `holidays`), затем rebase хвоста. Проверки те же.
4. **Рестайл onboarding** (на `onboarding`), затем rebase хвоста. Проверки те же.
5. **Рестайл feedback** (на `feedback`). Проверки те же.
6. **Новая ветка `home-city`** от вершины `feedback`: «мой город» в часах и погоде, подсказка под приветствием, бэкенд погоды расширяется без смены контракта.
   → проверка: без выбранного города главная как V1; тесты погоды из main не менялись.
7. **PR по очереди** в main: news-moderation → holidays → onboarding → feedback → home-city. Выкат БД по `db/README.md` каждой ветки (0014 → 0018) до слияния кода.

---

## ТЗ для исполнителя

### Общие правила (на всех этапах)

- Работать строго по списку файлов этапа. Если нужен файл вне списка, остановиться и вернуть открытый вопрос.
- **Запрещено трогать:** `frontend/src/modules/{analytics,warehouse,wb,purchasing,pricing}/**`, `frontend/src/core/theme.js`, `core/layout/PageHead.jsx`, `core/layout/SectionHead.jsx`, `core/home/RatesCard.jsx`, `core/pages/RoadmapPlaceholder.jsx`, `core/pages/LoginPage.jsx` (кроме одной строки этапа 1), а также файлы hr/team/news, которые Диана перерисовала: `HrPage.jsx`, `PeopleTab.jsx`, `hr/components/stats/**`, `hr.css`, `HomeBirthdays.jsx`, `HomeLeave.jsx`, `HomeEvents.jsx`, `NewsRows.jsx`, `RsvpControl.jsx`. Также запрещены `vite.config.js`, ревизии `0001–0013` и репозиторий purchasing_dashboard.
- `core/styles.css`: **только дописывать** новые правила в конец, отдельными блоками с комментарием. Ни одной изменённой или удалённой строки V1.
- `strings.js` (ядра и модулей) и `registry.js`: только дописывать. Строку `analytics` в `MODULES` не трогать, её правит Андрей у себя. Наши модули стоят после `news` в конце `MODULES`.
- Все UI-строки — в `core/strings.js` или `modules/<id>/strings.js`. Новых библиотек и TypeScript нет.
- Миграции 0014–0018 и их SQL в `db/` не менять (исключение — Q-P4, и только по решению пользователя).
- Цвета только через токены V1 (`--text-*`, `--bg-*`, `--border-*`, `--accent-*`, `--status-*`, `--data-*`). Своих hex в наших CSS/JSX нет.
- Коммиты на русском, в стиле репозитория.

### Правила рестайла (что брать из V1)

| Наш элемент | Как в V1 |
|---|---|
| Страница модуля news / holidays / feedback (через ModulePage) | `div.stack.module.<id>` + `<PageHead module={module} title={module.strings.tool}>{кнопки}</PageHead>`. Метку вида `[ 07 · КОМПАНИЯ ]` PageHead подставит сам (Q-P6). Образец — `HrPage.jsx` |
| Заголовок раздела/секции | `<SectionHead id=… title=…>{справа}</SectionHead>`. Справа: ссылка с классом `sec-link mono-label` (образец — `HomeLeave.jsx`), примечание `sec-note`, переключатель `.seg` |
| Блок главной | `section.home-block.tight` с `aria-labelledby` + `SectionHead`. Строки — `.people-row`, пусто — `.people-empty` / `.home-empty`. Образец — `HomeBirthdays.jsx` |
| Внутренние вкладки и фильтры (antd `Segmented`, `Tabs`) | `span.seg` с `role="group"` и `aria-label`, внутри `button.seg-btn` с `aria-pressed` (образец — WeatherCard). Для групп вкладок — как `hr-nav` в HrPage, но только по аналогии: классы `hr-*` не переиспользовать |
| Подписи, даты, счётчики, метки | Моно-капс: класс `mono-label`, для цифр — `mono`. Капс задаётся в CSS, не в строках |
| Выбор из карточек (категория обратной связи, тип записи) | `.card-options` с antd Radio/Checkbox |
| Modal, Drawer, Form, Select, Button, Tag, Alert | antd как есть: тема V1 уже даёт прямые углы, цвета и шрифты. Убрать наши инлайн-`style` с цветами/радиусами, если они есть |
| Удалённые классы `home-card*`, `home-panel`, `news-col-title`, `greeting*`, `home-layout`, `home-col`, `home-aside` | Не использовать. После переноса grep по `frontend/src` даёт 0 совпадений |
| Экраны, которые Диана не перерисовывала (профиль, админка, HR-drawer) | Новых раскладок не делать: только `SectionHead` вместо самодельных заголовков и токены |

---

### Этап 0. Подготовка

```
git fetch origin
git tag backup/news-moderation-pre-v1 news-moderation
git tag backup/holidays-pre-v1 holidays
git tag backup/onboarding-pre-v1 onboarding
git tag backup/feedback-pre-v1 feedback
git tag backup/home-weather-2days-pre-v1 home-weather-2days
```
Перед rebase убедиться, что внутрь переносимого диапазона указывают только 4 ветки цепочки (проверено 29.10: news-moderation, holidays, onboarding, feedback):
```
for c in $(git rev-list 798e8d0..feedback); do git branch --points-at $c; done | sort -u
```
Если в выводе есть другая ветка, остановиться и вернуть вопрос: `--update-refs` молча перепишет и её. Теги не пушить. Пробные прогоны `--update-refs` на копиях веток **запрещены**: флаг всё равно сдвинет настоящие ветки, которые указывают в переносимый диапазон. Откат: `git branch -f <ветка> backup/<ветка>-pre-v1`.

### Этап 1. Перенос цепочки

```
git checkout feedback
git rebase --update-refs --onto origin/main 798e8d0
```
`--update-refs` в git 2.47 работает без `-i`. Конфликты решаются по целевому содержимому ниже: за основу всегда берётся версия V1, и в неё вписывается наша логика. Изменения V1 не откатывать.

Rebase останавливается только на конфликтах, поэтому правки неконфликтующих файлов вносятся **на конкретных остановках**, иначе промежуточные вершины не пройдут гейты:
- остановка на `0569e99` (здесь `news.hidden` впервые становится функцией): решить конфликты `news.js`, `HomeNewsFeed.jsx`, `AppLayout.jsx` и **там же** править `moduleNumber.js`;
- остановка на `50d46a0`: решить конфликт `HubPage.jsx` и **там же** переписать `asideWidgets.js`;
- остановка на `d4590ef`: `LoginPage.jsx`, `DemoUserSwitcher.jsx` (и `AppLayout.jsx`, если конфликт повторится);
- после правок `git add <файлы>` и `git rebase --continue`. Если остановка случилась на другом коммите, решить её по тем же правилам и сообщить об этом в отчёте.

**`frontend/src/modules/news/lib/news.js`.** Оставить обе вставки: `eventDateBadge` из V1 и наши `initialOf`, `validate`, `payloadOf` вместе с импортом `strings`. Сначала функция V1, затем наши.

**`frontend/src/modules/news/components/HomeNewsFeed.jsx`.** Основа V1 (`home-block`, `SectionHead id="home-news"`, `featured={i === 0}`). Наше добавляется справа в `SectionHead`:
- `<Link to="/profile?section=proposals" className="sec-link mono-label">{s.myProposals}</Link>`;
- `<button type="button" className="sec-link mono-label news-propose" onClick={…}>{s.propose}</button>`.

Ниже монтируется `ProposalModal`, как сейчас. В `news.css` дописать сброс кнопки `.news-propose` (без фона и рамки, `padding:0`, `cursor:pointer`, `font:inherit`) и отступ между ссылкой и кнопкой. В узкой колонке подписи переносятся, горизонтальной прокрутки нет.

**`frontend/src/core/layout/AppLayout.jsx`.** Основа V1 и ровно эта правка:
```js
import { isModuleHidden } from '../access.js'
import { moduleNumber } from './moduleNumber.js'
// …
const navModules = MODULES.filter((m) => !isModuleHidden(m, me)).map((m) => ({
  ...m,
  num: moduleNumber(m.id),
  allowed: (me.module_access[m.id] ?? 'none') !== 'none',
}))
```
Если `pad2` после этого нигде не используется, удалить его. Остальное как в V1.

**`frontend/src/core/layout/moduleNumber.js`.** Меняется одна строка фильтра (Q-P6) и комментарий:
```js
// Номер модуля как в меню: 01, 02, … Не считаются только модули с hidden === true;
// скрытые по пользователю (hidden — функция) стоят в конце MODULES и номер имеют.
const i = MODULES.filter((m) => m.hidden !== true).findIndex((m) => m.id === id)
```

**`frontend/src/core/pages/HubPage.jsx`** (конфликт в `50d46a0`). Основа V1 полностью: hero и два `home-row`. Наше:
- загрузка `GET /core/home/widgets` как было (`config`: `undefined` — грузится, `null` — ошибка);
- в `home-side` второго ряда: сначала `<RatesCard />`, затем вместо `widgetsOf(null)` блоки модулей `applyWidgetConfig(ASIDE_WIDGETS, config).filter((w) => w.visible(me))`. Пока `config === undefined`, на месте **только этих** блоков стоит `<Spin size="small" />`: выключенные не должны рендериться и делать запросы (требование TZ-news-moderation);
- `widgetsOf('banner' | 'left' | 'center')` — как в V1;
- список настраиваемых блоков HubPage берёт из `ASIDE_WIDGETS` (см. ниже), а не фильтрует `HOME_WIDGETS` сам: так главная и редактор виджетов не разойдутся.

**`frontend/src/core/home/asideWidgets.js`.** Это каталог настраиваемых виджетов. Файл и экспорт `ASIDE_WIDGETS` остаются (их импортирует `HomeWidgetsEditor`), содержимое заменяется на `HOME_WIDGETS.filter((w) => !w.slot)`. Импорты `ClocksCard`/`WeatherCard`/`RatesCard` и `strings` удалить. Комментарий: «часы, погода и курсы — постоянные блоки раскладки V1, не настраиваются (TODO(Q-P5))». Сохранённые ранее id `clocks`/`weather`/`rates` отфильтрует `applyWidgetConfig`, поэтому бэкенд, таблицу `home_widgets` и миграцию 0015 не трогать. `widgetConfig.js` и его тесты не меняются.

**`frontend/src/core/layout/DemoUserSwitcher.jsx`.** Версия V1, в `label` наша защита: `` `${u.full_name} · ${strings.levels[u.access_level] ?? strings.dash}` ``.

**`frontend/src/core/pages/LoginPage.jsx`.** Версия V1 плюс одна строка после `<span className="login-note">{s.demoHint}</span>`: `<span className="login-note">{s.demoOnboardingHint}</span>`.

**Проверка этапа 1.** После rebase переключиться по очереди на каждую из 4 вершин (`news-moderation`, `holidays`, `onboarding`, `feedback`) и на каждой выполнить `cd backend && pytest`, затем `cd frontend && npm test && npm run lint && npm run build`. Если на промежуточной вершине что-то падает, исправление вносится коммитом **в ту же ветку**, после чего из `feedback` выполняется `git rebase --update-refs <ветка>`. Тесты `home.test.js` и `widgetConfig.test.js` меняться не должны; если меняются, вернуть вопрос.

### Этап 2. Рестайл news-moderation (коммиты на `news-moderation`)

Файлы (только эти):
- `modules/news/NewsAdminSection.jsx` — страница «Редактор новостей»: `stack module news` + `PageHead` (кнопка «Создать» в `children`). Вкладки review/current/past/drafts: `Segmented` → `.seg`, число записей на проверке — класс V1 `nav-badge`. Секции «Плашка» и «Виджеты главной» — через `SectionHead`.
- `modules/news/components/HomeWidgetsEditor.jsx` — `SectionHead` «Виджеты главной» + `sec-note` «Часы, погода и курсы закреплены». Строки как `.people-row`: подпись, `Switch`, стрелки. «Сохранить» справа.
- `modules/news/components/BannerEditor.jsx`, `NewsEditorDrawer.jsx`, `NewsForm.jsx`, `ProposalModal.jsx`, `NewsItemModal.jsx` — только убрать инлайн-цвета и радиусы (если есть), выбор типа записи сделать через `.card-options`. Логику не менять.
- `modules/news/MyProposalsSection.jsx` — заголовки через `SectionHead`, статусы — antd `Tag`.
- `modules/news/news.css` — дописывать/править только наши правила `news-admin-*`, `news-move`, `news-note`, `news-propose`: линии 1px `--border-default`, даты моноширинным шрифтом. Правила V1 в файле не трогать.
- `modules/news/strings.js` — только дописывать (например `widgets.fixedNote`).

После коммитов: `git checkout feedback && git rebase --update-refs news-moderation`. Конфликты в `strings.js`/`news.css` решаются объединением.

### Этап 3. Рестайл holidays (коммиты на `holidays`)

- `modules/holidays/components/HomeHolidays.jsx` — `section.home-block.tight` + `SectionHead id="home-holidays"`. Справа в шапке кнопка-ссылка «Календарь» (`sec-link mono-label`, button со сбросом, как `news-propose`) вместо `Button type="link"` внизу. Страна — `mono-label`. Строки — `.people-row`: период моноширинным слева, название, «дн.» моноширинным справа. Ошибка — `.people-empty` с текстом вместо `Alert`.
- `components/CalendarModal.jsx`, `YearCalendar.jsx`, `DaysModal.jsx` — antd как есть. Выбор страны и года — `.seg`. Месяцы и дни недели — моно-капс.
- `HolidaysAdminSection.jsx` — `stack module holidays` + `PageHead`, переключатели страны и года — `.seg`, секции — `SectionHead`.
- `holidays.css` — меняются только наши правила `hc-*`:
  - выходной/праздник — текст `--accent-primary`, фон `--accent-soft`;
  - перенесённый рабочий день — `--status-success` с подчёркиванием;
  - сокращённый день — `--bg-surface-secondary` с пунктиром;
  - без `box-shadow` и `border-radius`.

После коммитов: `git checkout feedback && git rebase --update-refs holidays`.

### Этап 4. Рестайл onboarding (коммиты на `onboarding`)

- `core/pages/OnboardingPage.jsx` — экран вне `AppLayout`. `Card`/`Typography.Title` заменить на структуру V1: `div.stack.onboarding` + `PageHead eyebrow={…} title={…} subtitle={…}`. Подсказка над анкетой — `subtitle` или `sec-note`. Анкета (`ONBOARDING_PROFILE_FORM`) не меняется. Классы `login-*` Дианы не переиспользовать. Нужные правила дописать в конец `core/styles.css` блоком `/* ---- онбординг ---- */` (поля страницы, max-width).
- В `OnboardingPage.jsx` демо-полоса использует классы `demo-banner`, `dot`, `switcher`, которых в V1 нет (проверено скриптом: других «сирот» в наших JSX после рестайла не остаётся). Заменить её на приём V1 из шапки `AppLayout`: `<span className="demo-flag">{strings.layout.demoData}</span>` + `<DemoUserSwitcher />` в одной строке справа сверху. Обёртку стилизовать в блоке `/* ---- онбординг ---- */`.
- `core/admin/OnboardingTab.jsx` и онбординг-элементы `core/admin/UsersTab.jsx` — заголовки через `SectionHead`, бейджи — antd `Tag`. Раскладку админки не менять.
- `modules/hr/components/SubmissionDrawer.jsx`, `SubmissionsTab.jsx` (диалог одобрения HR) — antd как есть, убрать инлайн-цвета.
- `core/strings.js` — дописать подпись-метку экрана онбординга (например «Первый вход»).

После коммитов: `git checkout feedback && git rebase --update-refs onboarding`.

### Этап 5. Рестайл feedback (коммиты на `feedback`)

- `modules/feedback/components/HomeFeedbackCard.jsx` — `home-block tight` + `SectionHead id="home-feedback"`, короткий текст цветом `--text-secondary`, кнопка открытия — antd `Button type="primary"`.
- `components/FeedbackModal.jsx` — категория через `.card-options` (Radio), анонимность — antd `Switch`. Логику не менять.
- `FeedbackAdminSection.jsx` — `stack module feedback` + `PageHead`, фильтры — `.seg`, список — строки с линией 1px, дата моноширинным.
- `MyFeedbackSection.jsx` — `SectionHead`, статусы — `Tag`.
- `feedback.css` — только наши правила, токены V1, без `--radius-card` и теней.

### Этап 6. Ветка `home-city`: часы, погода, подсказка

`git checkout -b home-city feedback`. Ветку `home-weather-2days` не сливать. Из неё вручную, через `git show home-weather-2days:<путь>`, переносятся только названные ниже фрагменты.

**6.1 Бэкенд: `backend/app/core/home.py`, `backend/app/core/routes_core.py`, `backend/tests/test_home.py`**

Контракт V1 сохраняется, все изменения аддитивные:
```
GET /core/home/weather            -> как сейчас: { source, cities: [yerevan, moscow] }
GET /core/home/weather?city=kazan -> { source, cities: [yerevan, moscow, kazan] }
элемент cities: { id, timezone, updatedAt, stale, days: [ {date, min, max, symbol, …как сейчас…} ] }
days[0] дополнительно: slots: [ {id, temp, tempMin, tempMax, symbols, precip, wind, past} ]  (только если days[0] = «сегодня» города)
```
- `CITIES` — 17 городов из `home-weather-2days` в том же порядке, первые два `yerevan` и `moscow`. Добавить `DEFAULT_CITY_IDS = ("yerevan", "moscow")`.
- `city` ищется только по `id` в белом списке `CITIES`:
  - известный город вне `DEFAULT_CITY_IDS` добавляется **третьим**;
  - `yerevan`, `moscow`, неизвестный или пустой `city` → 2 города, без ошибки; значение нигде не отражается.
- Подбор по `tz` (`resolve_city` из 2days) **не переносить**. Параметр: `city: str | None = Query(None, max_length=40)`.
- Перенести из 2days: `SLOTS`, `_num`, `aggregate_slots`; `parse_met` возвращает кортеж из 3 элементов; `slots_by_date` в состоянии города; ленивое создание состояния `_weather.setdefault(id, _new_city_state())`; `reset_cache` через `clear()`.
- `select_days` и `WEATHER_DAYS = 7` остаются как в main. `slots` с флагом `past` (как считает `weather_payload` в 2days) кладутся только в `days[0]`.
- К MET обращаемся не чаще одного раза на каждый возвращаемый город за запрос (не больше 3). Правила кэша не меняются: час, `Expires`, 304, 600 с после сбоя, 24 ч.
- Тесты:
  - все существующие тесты погоды из main проходят без изменений;
  - без `city` — 2 города; `city=kazan` — 3, третий `kazan`; `city=moscow` — 2; `city=zzz` — 2; длина больше 40 — 422;
  - `slots` есть только у `days[0]`;
  - повторный запрос `city=kazan` в пределах кэша не обращается к MET;
  - тесты `aggregate_slots` из 2days.
- В `docs/TZ-home.md` дописать абзац о параметре `city` и поле `slots`. `docs/TZ-home-weather.md` из 2days не переносить.

**6.2 Фронт: новые файлы**
- `core/home/myCity.js` — чистые функции, без React:
  - `CITY_ZONES` — 17 элементов `{ id, timeZone }`, совпадает с бэкендом (в комментарии ссылка на `home.py`);
  - `MY_CITY_KEY = 'hub.myCity'`;
  - `loadMyCity(storage)` (неизвестный id → `null`) и `saveMyCity(storage, idOrNull)`;
  - `clockZones(myCityId, now = new Date())` по Q-P2: `null` или `yerevan` → [Ереван, Москва]; если `formatClock(now, my.timeZone) === formatClock(now, "Europe/Moscow")` → [мой, Ереван]; иначе → [мой, Москва]. Сравнивается текущее время, а не id зоны: у Минска и Стамбула свои id, но время московское.
- `core/home/myCity.test.js` — все ветви `clockZones`, включая Минск и Стамбул (→ Ереван вторым) и Тбилиси (→ Москва вторым); `loadMyCity` с мусором в storage.
- `core/home/useHomeWeather.js` — хук. Запрос `/core/home/weather`, при выбранном городе — с `?city=<id>`; при смене города перезапрос. Возвращает `{ loading, data, cityId, setCityId }`. Активный город по умолчанию (Q-P3) — мой, если он есть в `data.cities`, иначе `cities[0]`.
- `core/home/CityPicker.jsx` — шестерёнка `SettingOutlined` (`@ant-design/icons` уже есть) с `aria-label`. По клику antd `Popover` с `Select showSearch` по 17 городам (подписи из `strings.hub.home.cities`) и пунктом «Не выбран» для сброса. Пропсы: `{ value, onChange, className }`.
- `core/home/WeatherAdvice.jsx` — строка под приветствием: `days[0].slots` активного города → `adviceFor` → `adviceText`. Нет слотов или совета — `null`, пустой строки не выводить. Комментарий «Временное решение (решение пользователя 29.10)».

**6.3 Фронт: правки существующих файлов**
- `core/home/weather.js` — дописать из 2days `KIND_SEVERITY`, пороги, `slotKind`, `adviceFor`, `hashString`, `adviceText`. `loadCity`, `saveCity`, `browserTimeZone`, `weatherPath` **не переносить**.
- `core/home/weather.test.js` — дописать тесты советов из 2days.
- `core/strings.js` — словарь `hub.home.cities` дополнить до 19 ключей (4 из V1 + 15 из 2days, ключи как в 2days). Дописать `adviceWhen`, `advice` и подписи выбора города (заголовок, aria, «Не выбран»).
- `core/home/ClocksCard.jsx` — необязательные пропсы `{ myCity, onMyCity }`; `zones = clockZones(myCity ?? null)` вместо `CLOCK_ZONES.slice(0, 2)`. Если передан `onMyCity`, внутри `.hero-clocks` последним элементом добавить `<CityPicker className="hero-clocks-gear" …/>`. Разметка и классы часов не меняются.
- `core/home/WeatherCard.jsx` — убрать собственный запрос (`useEffect`/`useState`). Принимать данные и обработчики из `useHomeWeather` через пропсы. В `SectionHead` после `.seg` добавить `<CityPicker className="weather-gear" …/>`. Вся остальная разметка (`weather-now`, `Week`, stale, источник) без изменений. Третий город появится в `.seg` сам: он приходит в `cities`.
- `core/pages/HubPage.jsx`:
  - состояние «мой город» из `loadMyCity(localStorage)`, при смене `saveMyCity`;
  - вызов `useHomeWeather(myCity)`, пропсы в `ClocksCard` и `WeatherCard`;
  - `<WeatherAdvice …/>` внутри `.hero-main` сразу после `h1.hero-title`.
- `core/api/mock/home.js` и `home.test.js` — то же поведение `city`, что на бэкенде.
- `core/styles.css` — **дописать в конец** блок `/* ---- мой город и подсказка (home-city) ---- */`:
  - `.hero-clocks-gear`: `position:absolute; top:0; right:0` внутри `.hero-clocks` (у него уже `position:relative`); кнопка 24×24 без фона, красный цвет как у текста `.hero-clock.prime`, видимый `:focus-visible`;
  - `.weather-gear`: без фона, цвет `--text-secondary`, при наведении `--accent-primary`;
  - `.hero-advice`: `margin:0`, 16px, `var(--font-sans)`, белый с `opacity:.85`, `max-width:560px`;
  - если `.seg` из трёх кнопок («САНКТ-ПЕТЕРБУРГ») не помещается в `.home-side` на 1280 и 375 px, добавить `.home-block .seg { flex-wrap: wrap; }`. Существующее правило `.seg` не менять.

---

## Критерии приёмки для ревьюера

**Перенос (этап 1)**
- [ ] 5 тегов `backup/*-pre-v1` указывают на `50d46a0`, `44c5b44`, `0d9d503`, `deb4ec4`, `14621d2`.
- [ ] `git merge-base --is-ancestor origin/main <ветка>` выполняется для news-moderation, holidays, onboarding, feedback, home-city. Merge-коммитов в `origin/main..feedback` нет.
- [ ] До этапа 6 `git diff backup/feedback-pre-v1 feedback -- backend db` пустой: бэкенд и миграции перенесены без изменений.
- [ ] `0014_news_moderation.py` имеет `down_revision = "0013"`, цепочка 0014→0018 непрерывна. `alembic upgrade head` и `alembic downgrade 0013` проходят на локальном Postgres из compose. `test_database.py` ждёт версию `0018`.
- [ ] На **каждой** из 4 вершин зелёные `pytest`, `npm test`, `npm run lint`, `npm run build` (лог приложен к PR).

**Экраны Дианы не изменены**
- [ ] `git diff origin/main <вершина> --` по перечню «Запрещено трогать» из общих правил пустой.
- [ ] `git diff origin/main <вершина> -- frontend/src/core/styles.css | grep '^-[^-]'` пустой: строки только добавлены.
- [ ] `AppLayout.jsx` отличается от V1 только импортами `isModuleHidden`/`moduleNumber` и выражением `navModules` (и удалением `pad2`, если он стал не нужен). `moduleNumber.js` — строкой фильтра и комментарием. `LoginPage.jsx` — одной строкой `login-note`. `DemoUserSwitcher.jsx` — `?? strings.dash`.
- [ ] Строка `analytics` в `registry.js` и папка `modules/analytics` не тронуты, наши модули стоят после `news`.
- [ ] У обычного сотрудника номера в меню совпадают с V1 (01–06). У редактора новостей «Редактор новостей» получает 07 и в меню, и в метке `[ 07 · КОМПАНИЯ ]` PageHead.

**Рестайл (этапы 2–5)**
- [ ] `grep -rnE "home-card|home-panel|news-col-title|greeting-|home-layout|home-col|home-aside" frontend/src` — 0 совпадений.
- [ ] Сирот нет: каждый `className` в изменённых нами JSX (`git diff --name-only origin/main <вершина> -- "frontend/src/*.jsx"`) имеет селектор в CSS ветки. В частности, в `OnboardingPage.jsx` нет `demo-banner`, `dot`, `switcher`.
- [ ] В наших правилах `holidays.css`, `feedback.css`, `news.css` и в `OnboardingPage.jsx` нет hex-цветов, ненулевых `border-radius` и `box-shadow`.
- [ ] Наши страницы модулей используют `PageHead` и `SectionHead`, вкладки и фильтры — `.seg` с `aria-pressed`, блоки главной — `home-block` + `SectionHead`.
- [ ] Все новые подписи лежат в `strings.js`, русского текста прямо в JSX нет.
- [ ] Главная: ряд 1 — новости | погода; ряд 2 — события | курсы, под ними настраиваемые блоки (дни рождения, отпуска, праздники, обратная связь) в сохранённом порядке.
- [ ] Выключенные блоки не рендерятся и не делают запросов (проверка во вкладке Network). Сохранённые `clocks`/`weather`/`rates` игнорируются. Без доступа к новостям остаются только правые колонки, ошибок нет.
- [ ] Редактор виджетов показывает 4 модульных блока, часов/погоды/курсов в списке нет. Сохранение работает в mock.

**Демо-проверка** (`VITE_DEMO_MODE=true`, светлая **и** тёмная тема, ширина 1440 и 375). Пройти:
- главная, «Предложить новость» → ProposalModal, «Мои предложения» в профиле;
- «Редактор новостей»: все вкладки, порядок закреплённых, плашка, виджеты;
- виджет «Праздники и выходные» → CalendarModal/YearCalendar, раздел производственного календаря и DaysModal;
- вход онбординг-учёткой → `/onboarding`, вкладка «Онбординг» в админке, онбординг-элементы UsersTab, одобрение анкеты HR;
- карточка «Обратная связь» → FeedbackModal, раздел «Обратная связь», «Моя обратная связь».

Скриншоты обеих тем приложить к PR. Горизонтальной прокрутки нет, в тёмной теме текст читается.

**home-city (этап 6)**
- [ ] Без выбранного города главная выглядит как V1 (01 Ереван / 02 Москва, погода ЕРЕВАН/МОСКВА). Отличие только в двух шестерёнках.
- [ ] Выбор города:
  - «Казань» → часы 01 Казань / 02 Ереван;
  - «Новосибирск» → 01 Новосибирск / 02 Москва;
  - «Москва», «Минск», «Стамбул» → 01 <город> / 02 Ереван; «Тбилиси» → 01 Тбилиси / 02 Москва;
  - часов всегда 2; в погоде появляется третья кнопка, и она активна;
  - выбор переживает перезагрузку; «Не выбран» возвращает вид V1.
- [ ] Подсказка под «Добрый вечер, Карен!» меняется при переключении городов в погоде. Без данных её нет. В обеих темах она белая.
- [ ] `/core/home/weather` без параметра отдаёт форму V1, тесты main не менялись. С `city` из списка — 3 города; мусор или дубль — 2; длина больше 40 — 422. Значение `city` не попадает ни в URL к MET, ни в лог.
- [ ] Списки городов в `home.py` и `myCity.js` совпадают: 17 id, те же зоны.
- [ ] Шестерёнки доступны с клавиатуры и имеют `aria-label`, Popover закрывается по Esc.
- [ ] `pytest`, `npm test`, lint и build зелёные.

## Открытые вопросы к пользователю

Q-P1…Q-P6 — в разделе 2. Блокирует только Q-P4: до PR `news-moderation` в main нужно договориться с Андреем о номерах миграций (мы 0014–0018, он с 0019).
