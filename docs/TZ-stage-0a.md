# ТЗ: Этап 0a — оболочка интерфейса (демо на Vercel)

Автор: `lead` (2026-10-01), с правками пользователя. Контекст: `ARCHITECTURE.md`, `CLAUDE.md`, PDF-концепция (стр. 3 — хаб, стр. 5 — вариант 2 с меню сверху, стр. 4/5 — таблица «Закупки»).
Цель: фронтенд на моках для показа коллегам на Vercel. Бэкенда, БД, очереди, файлов, LLM нет.

## Правки пользователя к исходному ТЗ lead
1. **Создание и отключение пользователей — ДЕЛАЕМ** (сотрудник может уволиться): в админке «Добавить пользователя» и «Отключить/Включить» (деактивация, не удаление; отключённый не может войти и получает `none`).
2. Привязка модулей к отделам — без UI; задаётся в данных мока при создании модуля разработчиком.
3. Защита демо-ссылки не нужна.
4. **Строки модуля лежат в самом модуле:** `modules/<id>/strings.js`; общие строки ядра — `core/strings.js`. Новый модуль = папка (со своими строками) + одна строка в `registry.js`. «Кнопки добавить модуль» на сайте нет, карточка «+ новый модуль» — только визуальный плейсхолдер из PDF (некликабельная).
5. Модули добавляют разработчики, хаб делается гибким заранее.

## Рамки
Работать ТОЛЬКО в `frontend/` (новая папка). `ARCHITECTURE.md`, `CLAUDE.md`, PDF, purchasing_dashboard не трогать.
**Не делать:** бэкенд/docker/БД/сеть; реальную авторизацию/JWT; i18n-библиотеку, TypeScript; axios, dayjs, redux/zustand/react-query, CSS-фреймворки, vitest/jest и любые зависимости сверх списка; реальную загрузку/скачивание файлов (нет `<input type=file>`/Upload); удаление пользователей/отделов; UI привязки модулей к отделам; автодискавери модулей (`import.meta.glob`); `.env` с значениями (только `.env.example`); proxy в vite.config.js. Неясное — `// TODO(Q-x)` + в отчёт. Результаты technical-analyst по версиям (antd 6, react-router 7, Vite, Vercel) приоритетнее названий пропов в этом ТЗ; расхождения — в отчёт.

## 1. Скаффолд
`npm create vite@latest frontend -- --template react` (JS), удалить демо-контент. `index.html`: `lang="ru"`, title «Платформа инструментов».
dependencies только: `react`, `react-dom`, `antd` (6.x), `@ant-design/icons`, `react-router`/`react-router-dom` 7.x (по analyst). devDependencies — только из шаблона Vite.
scripts: `dev`, `build`, `preview`, `lint` (`eslint . --max-warnings 0`), `test` (`node --test`, при необходимости с явным glob).
`.gitignore`: `node_modules`, `dist`, `.env`, `.env.*`, `!.env.example`, `.vercel`. `.env.example`: `VITE_DEMO_MODE=false` с комментарием.

## 2. Структура
```
frontend/
  vercel.json, README.md
  src/
    main.jsx               # ConfigProvider(ru_RU) + antd App + BrowserRouter + AuthProvider + AppRoutes
    core/
      strings.js           # строки ядра
      config.js            # DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true'
      access.js, access.test.js
      format.js            # formatPrice (Intl ru-RU), formatDateTime
      api/ index.js, client.js, session.js, mock/{transport,handlers,data}.js
      auth/ AuthContext.js, AuthProvider.jsx, useAuth.js, RequireAuth.jsx, RequireAdmin.jsx
      layout/ AppLayout.jsx, DemoUserSwitcher.jsx
      pages/ LoginPage, HubPage, ModulePage, RoadmapPlaceholder, NoDataAccess, ForbiddenPage, NotFoundPage
      admin/ AdminPage, UsersTab, DepartmentsTab, validation.js, validation.test.js
      AppRoutes.jsx
    modules/
      registry.js
      purchasing/ PurchasingPage.jsx, strings.js
      wb/ analytics/ pricing/   # только strings.js (roadmap-модули без экрана)
```

## 3. Права: `core/access.js` (чистые функции, без React/sessionStorage/мока)
```js
ACCESS_LEVELS = ['admin','superuser','employee','viewer']
// доступ к модулю: 'none' | 'structure' | 'view' | 'run'
computeModuleAccess(user, moduleDepartmentIds)
canSeeData(access)   // view|run
canRun(access)       // run
canManageUsers(user) // только активный admin
```
Правила: `null`/`is_active===false`/неизвестный уровень → `none`; admin, superuser → `run`; viewer → `structure` всегда; employee → `run` если отделы пользователя пересекаются с отделами модуля, иначе `view`.
Тесты (по строке на кейс), `user.department_ids`, модуль `[отделы]`:
1 admin,[] / [1] → run · 2 admin,[1] / [1] → run · 3 superuser,[] / [1] → run · 4 superuser,[2] / [1] → run · 5 employee,[1] / [1] → run · 6 employee,[2] / [1] → view · 7 viewer,[1] / [1] → structure · 8 viewer,[2] / [1] → structure · 9 employee,[] / [1] → view · 10 employee,[1] / модуль [] → view · 11 employee,[2] / [1,2] → run · 12 employee,[1,3] / [3] → run · 13 employee [1] is_active=false → none · 14 access_level='boss' → none · 15 user=null → none · 16 admin is_active=false → none.
Плюс `canManageUsers` (admin true; superuser/employee/viewer/null false; неактивный admin false) и `canSeeData`/`canRun` для всех 4 значений.

## 4. Слой данных
`client.js`: `createClient(transport)` → `{get, post, patch}`; `ApiError {status, message}` (401/403/404/409/422, русский текст). При 401 клиент чистит сессию; редирект делает AuthProvider/RequireAuth.
`mock/transport.js`: диспетчер `"METHOD /path"` (+`:id`), задержка ~200 мс, `structuredClone` входа/выхода, неизвестный путь → 404.
**Только `core/api/index.js` выбирает транспорт; `core/api/mock/*` импортируется только оттуда.** Позже добавится `http/transport.js` без правки экранов.
Сессия: токен `mock:<userId>` в sessionStorage (`hub.token`).
Эндпоинты мока (snake_case):
- `POST /auth/login {email,password}` → `{token}`; email без учёта регистра; пароль у всех `demo`; неверно или неактивен → 401 «Неверная почта или пароль».
- `POST /auth/demo-login {user_id}`, `GET /auth/demo-users` — только при `DEMO_MODE`, иначе 404.
- `POST /auth/logout`.
- `GET /core/me` → `{id,email,full_name,access_level,departments[],can_manage_users,module_access:{<moduleId>: 'none'|...}}`; `module_access` считается `computeModuleAccess` по `data.moduleDepartments[id] ?? []` для каждого модуля из реестра.
- `GET /core/runs?limit=5` — запуски только модулей, где `canSeeData`.
- `GET /modules/purchasing/latest` → `{supplier, uploaded_at, rows:[{sku,name,price,buy,qty,reason}]}`; без `canSeeData` → 403.
- `GET /admin/users`; `POST /admin/users {email, full_name, access_level, department_ids}` (создание; email уникален без учёта регистра → 409; формат email и обязательность ФИО → 422; в моке пароль всегда `demo`); `PATCH /admin/users/:id {access_level?, department_ids?, is_active?}`. Все — только `can_manage_users`, иначе 403. Ошибки 422: смена собственного уровня («Нельзя изменить собственный уровень доступа»), **отключение самого себя**, неизвестный уровень, несуществующий отдел.
- `GET /admin/departments` (с `user_count`); `POST /admin/departments {code,name}`; `PATCH /admin/departments/:id {name}` (код не меняется — при передаче code → 422; дубликат → 409; валидация общая с UI).
Моковые данные (`data.js`, in-memory, сбрасываются при перезагрузке):
- departments: 1 purchasing «Закупки», 2 wb «WB-отдел», 3 analytics «Аналитика», 4 pricing «Ценообразование». moduleDepartments: `{purchasing:[1], wb:[2], analytics:[3], pricing:[4]}` — это данные, а не реестр.
- users (@example.com, вымышленные): Карен В. admin; Руководитель superuser; Ани С. employee[1]; Сотрудник WB employee[2]; Наблюдатель viewer; «Сотрудник закупок и аналитики» employee[1,3]; плюс один **отключённый** сотрудник (для демонстрации).
- runs: 4–5 по purchasing (done, running, queued, failed). purchasing.latest: 4 строки как в PDF (SK-1042 Кроссовки летние 2340 да 120; SK-1198 Куртка демисезон 4120 да 60; SK-0871 Шапка вязаная 560 нет 0; SK-1305 Перчатки зимние 380 да 200 + причины из PDF).

## 5. Реестр модулей `modules/registry.js`
Элемент: `{id, status:'mvp'|'roadmap', icon, color, strings (import из ./<id>/strings.js), Component: lazy(...) | null}`. Порядок = порядок вкладок и карточек. Отделы в реестре НЕ указываются. Комментарий-чек-лист в начале файла: папка `modules/<id>/` (+`strings.js`) + строка в `MODULES` + (позже) бэкенд-манифест. Страница модуля получает пропсы `{module, access}` и не вычисляет права сама (можно `canSeeData`/`canRun`, `api`, `format`, `NoDataAccess`, общие строки ядра). Если JSX-иконка в `.js` мешает — хранить компонент иконки без JSX.

## 6. Строки
Ядро — `core/strings.js`, модуль — `modules/<id>/strings.js`. В JSX нет русских литералов (включая aria-label, placeholder, ошибки валидации). Приветствие `greeting(name, hour)` (утро/день/вечер). Уровни: admin — Администратор, superuser — Руководитель, employee — Сотрудник, viewer — Наблюдатель. Статусы запусков: done «Готово» (зелёный), running «В обработке» (оранжевый), queued «В очереди» (серый), failed «Ошибка» (красный). Статусы модулей MVP/ROADMAP.

## 7. Экраны
Маршруты: `/login`, `/`, `/modules/:moduleId`, `/admin` (RequireAdmin), `*` → 404. Всё кроме `/login` — RequireAuth + AppLayout; без сессии → `/login` со `state.from`, после входа возврат. Пока грузится `me` — Spin.
**Логин:** карточка, «Корпоративная почта» (формат email, `TODO(Q-D)` домен), «Пароль», «Войти»; ошибка — Alert. Нет «Регистрация/Забыли пароль»; мелко: «Пароль сбрасывает администратор». При `DEMO_MODE` — блок «Демо-вход» (кнопки по `/auth/demo-users`, подсказка «пароль для всех: demo»).
**Layout (меню сверху, вариант 2):** светлый Header; бренд «Платформа» → `/`; `Menu horizontal`: «Хаб» + модули с `module_access !== 'none'`, активный по URL, лишние уходят в «Ещё»; справа (при DEMO_MODE) «Войти как: …» (demo-login → refreshMe, остаёмся на URL, гарды дают 403 если нужно) и меню аватара (имя, уровень, отделы; «Пользователи и отделы» только `can_manage_users`; «Выйти»). При DEMO_MODE — Alert info: «Демо-версия: данные вымышленные, изменения сбрасываются при перезагрузке страницы».
**Хаб:** приветствие (имя — первое слово ФИО), «Все инструменты в одном месте»; сетка карточек (3 в ряд ≥1200px): иконка, Tag MVP/ROADMAP, название, описание, клик → модуль; модули `none` не показываются; последняя карточка «+ новый модуль» пунктирная и некликабельная. «Последние запуски»: если есть модуль с `canSeeData` — `GET /core/runs` (строка «**Закупки** · прайс … · Карен В.» + Tag статуса; пусто → «Запусков пока нет»); иначе (viewer) запрос НЕ делается, вместо списка `NoDataAccess`.
**ModulePage:** нет в реестре → 404; `none` → 403; roadmap/`Component===null` → `RoadmapPlaceholder` («Модуль в планах. Здесь появится рабочий экран.»); иначе `Suspense` + `Component`.
**PurchasingPage** (PDF стр. 5): «Закупки — автоотбор товара», «Поставщик: … · загружено <дата>», кнопки «Загрузить прайс» и «Скачать файл» (обе только `message.info` «появится на следующем этапе»).
- `run`: обе кнопки активны, таблица видна.
- `view`: таблица и «Скачать файл» видны; «Загрузить прайс» disabled + Tooltip «Запуск доступен сотрудникам отдела „Закупки“».
- `structure`: только заголовок; строку поставщика, таблицу, обе кнопки НЕ рендерить; `/modules/purchasing/latest` НЕ вызывать; вместо таблицы `NoDataAccess` («Нет доступа к данным. Ваш уровень доступа позволяет видеть только структуру модуля.»).
- Таблица: Артикул, Товар, Цена («2 340 ₽», вправо), Закупать (Tag «Да» зелёный / «Нет» красный), Кол-во (вправо), Почему; `rowKey="sku"`; состояния loading и error.
**AdminPage `/admin`**, Tabs:
- «Пользователи»: Table ФИО, Почта, Уровень (Tag), Отделы (Tag'и, пусто → «—»), **Статус (Активен / Отключён)**, действия «Изменить» и «Отключить»/«Включить» (с подтверждением; себя отключить нельзя — кнопка disabled + подсказка). Кнопка **«Добавить пользователя»**: Modal-форма (ФИО, корпоративная почта, уровень, отделы; подсказка «Пароль в демо: demo; в реальной системе его задаёт администратор»). «Изменить»: Modal (уровень + отделы), для себя уровень disabled; под Select уровня — описание выбранного уровня. После сохранения `message.success`, перезагрузка списка; при правке себя — `refreshMe()`. Отключённые строки визуально приглушены.
- «Отделы»: Table Код, Название, Сотрудников; «Добавить отдел» (Название + Код латиницей); «Переименовать» (код read-only).
- `validation.js`: `validateDepartmentName(name, existing, selfId?)` (trim; пусто; >64; дубликат без учёта регистра среди других), `validateDepartmentCode(code, existing)` (`/^[a-z][a-z0-9_]{1,31}$/`, уникальность), + `validateUserForm({email, full_name, access_level}, existingUsers)` (формат email, дубликат email без регистра, обязательное ФИО). Возвращают `null` или текст из strings. Тесты: пустое/пробельное имя; дубликат «закупки» vs «Закупки»; переименование в своё имя ок; код с кириллицей; код с заглавной; дубликат кода; валидный код; невалидный email; дубликат email; пустое ФИО; валидный пользователь.
403/404: antd `Result` с кнопкой «На главную».

## 8. Деплой на Vercel
`frontend/vercel.json` — SPA-rewrite на `/index.html` (форма по analyst; статика `/assets/*` не переписывается). README: Root Directory = `frontend`, Preset Vite, build `npm run build`, output `dist`, переменная `VITE_DEMO_MODE=true` ДО сборки (после изменения — Redeploy); секретов и бэкенда нет; локальный запуск, тесты, линт.

## 9. Отчёт implementer
Вывод `npm run build`, `npm run lint`, `npm test`; список файлов; отклонения от ТЗ (в т.ч. по ответам analyst); все `TODO(Q-x)`.

---

# Критерии приёмки для ревьюера
**Сборка и гигиена:** `npm ci && npm run build` без ошибок; `npm run lint` 0 ошибок/предупреждений; `npm test` зелёный; изменения только в `frontend/` (ARCHITECTURE.md, CLAUDE.md не тронуты, `backend/`/docker не созданы); dependencies ровно react, react-dom, antd@6, @ant-design/icons, react-router(-dom)@7 (нет axios, dayjs, TS, i18n, тестовых фреймворков, стейт-менеджеров); нет `.env`/`.env.local`, `.env.example` только `VITE_DEMO_MODE=false`; нет секретов, реальных почт (только `@example.com`); в `vite.config.js` нет proxy.
**Матрица прав:** в `access.test.js` все 16 строк §3 1:1 + `canManageUsers` + `canSeeData`/`canRun`; `computeModuleAccess` чистая.
**Модульность:** grep — `core/api/mock` импортируется только из `core/api/index.js`; экраны/модули не вызывают `computeModuleAccess` (права из `me.module_access`); отделы модулей заданы только в `mock/data.js`, нет `if (department === 'purchasing')`; **тест модульности:** временно добавить roadmap-модуль (папка со `strings.js` + строка в `MODULES`) → появляются вкладка, карточка, страница-заглушка без правки ядра, затем откатить; grep `src/**/*.jsx` — нет кириллических литералов (строки ядра в `core/strings.js`, строки модуля в `modules/<id>/strings.js`; допустимы только моковые данные).
**Сценарии вручную** (`npm run build && npm run preview`, `VITE_DEMO_MODE=true`): без сессии `/`, `/modules/purchasing`, `/admin` → `/login`, после входа возврат на исходный URL; `ani@example.com`/`demo` входит, неверный пароль → Alert; меню сверху (Хаб / Закупки / WB-карточки / Аналитика / Цены), активная подсвечена, на ~768px часть вкладок в «Ещё»; хаб: приветствие, 4 карточки + «+ новый модуль», MVP у Закупок и ROADMAP у остальных, последние запуски с цветными статусами. «Войти как»: **Карен (admin)** — таблица, обе кнопки активны, в меню аватара есть админка; **Руководитель (superuser)** — как admin, но без пункта админки, `/admin` → 403; **Ани (employee, Закупки)** — run; **Сотрудник WB** — таблица и «Скачать файл» видны, «Загрузить прайс» disabled с тултипом; **Наблюдатель (viewer)** — вкладки и карточки видны, на хабе «Нет доступа к данным», в Закупках нет таблицы/поставщика/кнопок, `/modules/purchasing/latest` не вызывается; **multi@** — Закупки run. Смена пользователя на `/admin` на не-админа → 403 без падения. **Админка:** смена уровня Ани на viewer → у Ани в Закупках «Нет доступа к данным»; у себя (Карен) уровень disabled и отключить себя нельзя; **создать пользователя** (валидная почта) → появился в списке, под ним можно войти паролем `demo`; дубликат почты и невалидная почта отклоняются; **отключить пользователя** → статус «Отключён», вход под ним даёт «Неверная почта или пароль», «Включить» возвращает доступ; добавить отдел «Логистика»/`logistics` → доступен в Select отделов пользователя; дубликат «закупки» и код `Логистика` отклоняются; переименование отдела отражается в тегах пользователей; перезагрузка сбрасывает изменения. Цена «2 340 ₽», «Да» зелёный, «Нет» красный. `/modules/xyz` и `/abc` → 404; roadmap-модуль → заглушка. Без `VITE_DEMO_MODE`: нет «Войти как», «Демо-вход», баннера; `/auth/demo-login` в моке → 404; вход по почте/паролю работает.
**Деплой:** `vercel.json` с SPA-rewrite, README со шагами Vercel; жёсткое обновление на `/modules/purchasing` и `/admin` открывает приложение, `/assets/*.js` отдаются как JS; после загрузки бандла в Network нет fetch/XHR.

---
## Правки после просмотра демо (2026-10-01)
- Карточка «+ новый модуль» на хабе убрана.
- «Закупки»: кнопка «Загрузить прайс» → «Загрузка файла»; верхняя «Скачать файл» убрана; вместо строк из файла — сводная таблица обработанных файлов (Файл, Поставщик, Загружен, Кто загрузил, Позиций, Кол-во, Сумма РРЦ, кнопка «Скачать» в каждой строке — пока заглушка). Эндпоинт мока `GET /modules/purchasing/files` заменил `/latest`. Позже в столбцы добавятся показатели (например, доля отобранного в %).
- **Форма «Новая обработка» (2026-10-05):** по кнопке «Загрузка файла» открывается панель с фильтрами (файл-заглушка и режим «по строкам / по лоту»; каналы WB / Retail Ереван / Retail Москва с долей; количество; скидка от РРЦ; бренды, категории, пол, сезон, размеры; пропуск повторов) и наборами параметров. Только интерфейс, без логики; моки `GET /modules/purchasing/options`, `POST /modules/purchasing/presets`. Код: `frontend/src/modules/purchasing/NewRunDrawer.jsx`.
- **Фильтры из файла (2026-10-05):** бренды, категории, размеры, сезон и год не вводятся вручную, а подтягиваются из выбранного файла (мок `POST /modules/purchasing/inspect`, 3 демо-файла); один бренд — просто строка, несколько — галочки; блок «Повторы» убран; наборы параметров хранят только общие настройки. Настоящий просмотр файла — часть этапа 1 (разбор прайса).
- **Упрощение фильтров (2026-10-05):** убраны «Бюджет на лот», «Не позже … недель до начала сезона», «Макс. закупочная цена», «Мин. наценка»; скидка — одно поле «Скидка от поставщика, % от РРЦ» (секция «Скидка»); секция «Количество» без бюджета.
