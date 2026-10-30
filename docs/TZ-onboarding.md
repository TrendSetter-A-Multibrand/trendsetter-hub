# ТЗ: онбординг нового сотрудника (самостоятельная регистрация по общему паролю, смена пароля, анкета, допуск через HR)

Редакция 4 (lead, 2026-10-29). Сверено с кодом ветки `onboarding` @ `44c5b44`: ревизии до `0016`, ветка стоит поверх `holidays` и `news-moderation`, а те — поверх `origin/main` @ `798e8d0`.
- Номера изменены на `0017`.
- Расхождения с кодом исправлены, список — в разделе «Сверка с кодом».
- Открытые вопросы закрыты решениями по умолчанию D1–D12. Что остаётся пользователю — в разделе «Остаются открытыми».
- Решения пользователя из редакции 3 (2026-10-27) действуют, кроме двух мест: D1 (домен) и D5 (подстановка карточки). Оба вынесены пользователю на подтверждение и не блокируют PR 1.

Образцы:
- `docs/TZ-news-moderation.md` и `docs/TZ-holidays.md` — нумерация, PR, stamp;
- `docs/TZ-security.md` — смена пароля, счётчик попыток;
- `db/README.md` — процесс миграций.

## Ветка и коммиты
- Работа идёт в локальной ветке **`onboarding`**, она уже создана. **Ничего не пушить**, другие ветки не создавать и не переключать. Ветку не ребейзить и не мержить `main` без команды пользователя.
- PR 1 и PR 2 — две последовательные серии коммитов в этой ветке. Сначала PR 1 целиком и его приёмка ревьюером, потом PR 2 поверх.
- **Зависимость.**
  - В `origin/main` последняя ревизия `0013`.
  - `0014`/`0015` (news-moderation) и `0016` (holidays) ещё не смержены.
  - Онбординг мержится и выкатывается **только после них**. Порядок выката БД: `0014` → `0015` → `0016` → `0017`.
- Индексировать только явными путями из «Файлы PR n» (`git add <путь>`). **Никогда** `git add -A` или `git add .`.

## Номера миграций и файлов
Последняя ревизия ветки — `0016_holidays.py`. Этой задаче принадлежит:

| PR | Ревизия Alembic | `down_revision` | SQL | Отметка версии |
|---|---|---|---|---|
| PR 1 | `backend/alembic/versions/0017_onboarding.py` | `"0016"` | `db/17_onboarding.sql` | `deploy/stamp_alembic_0017.sql` (`0016 → 0017`) |

PR 2 миграций не содержит.

**Правила (по образцам `0014`–`0016`):**
- **Ревизия** — по схеме `0016_holidays.py`: `SQL_FILES = ["17_onboarding.sql"]`, `_sql_dir()` с `HUB_SQL_DIR`, выполнение скрипта в `upgrade`.
  - Докстринг: «Онбординг нового сотрудника (флаги в users, таблица onboarding_settings). Выполняет db/17_onboarding.sql. В боевой базе скрипт и отметка версии выполняются вручную под doadmin (db/17_onboarding.sql, затем deploy/stamp_alembic_0017.sql) до слияния кода в main. Revision ID: 0017 / Revises: 0016».
- **SQL** ядра лежит в корне `db/`, номер файла = номер ревизии. Шапка — как у `16_holidays.sql`:
  - «-- ШАГ 17. Онбординг нового сотрудника (ядро, ревизия Alembic 0017).»
  - «-- Выполнять под doadmin, подключившись к базе defaultdb ПОСЛЕ 16_holidays.sql. Скрипт можно запускать повторно.»
  - «-- Права hub_app выдаются автоматически (ALTER DEFAULT PRIVILEGES из 01_core_hub.sql).»
- **Отметка версии** — как `deploy/stamp_alembic_0016.sql`: две строки комментария, затем `UPDATE trendsetter_hub.alembic_version SET version_num = '0017' WHERE version_num = '0016';`.
- **Перенумерация.** Перед стартом PR 1 и перед мержем:
  - выполнить `ls backend/alembic/versions` и `git fetch && git ls-tree --name-only origin/main backend/alembic/versions/`;
  - если `0017` занят (в `main` или в ветке появились новые ревизии, или news-moderation/holidays смержены под другими номерами), взять **следующий свободный** номер;
  - перенумеровать согласованно **всё**:
    - имя файла ревизии, `revision`, `down_revision`;
    - `db/NN_onboarding.sql` и `SQL_FILES`;
    - шапку «ШАГ NN … ПОСЛЕ <предыдущий>.sql»;
    - `deploy/stamp_alembic_NNNN.sql`;
    - ожидаемую версию в `backend/tests/test_database.py` (два места, см. «Тесты PR 1»);
    - имя SQL в `backend/tests/conftest.py`;
    - раздел `db/README.md`;
    - этот файл.
  - Одна голова, без merge-ревизий.

## Разбиение на два PR
- **PR 1 — бэкенд целиком** (миграция `0017`, самосоздание, лимиты, блокировка, админские эндпойнты, одобрение HR с доступом, тесты).
  - Самодостаточен и выкатывается «тёмным»: пока общий пароль не задан (`password_hash IS NULL`), самосоздание и вход общим паролем выключены. Для существующих пользователей поведение не меняется.
  - Проверяется только `pytest`.
  - UI для задания пароля нет. В `db/README.md` прямо написать: «общий пароль не задавать до выката PR 2».
- **PR 2 — фронт и mock.**
  - Шлюз `/onboarding`, экран онбординга, вкладка «Онбординг» в админке, `UsersTab`, диалог одобрения HR, строки, mock, фронтовые тесты.
  - Зависит от API PR 1.
  - Миграций нет.

## Решения пользователя (2026-10-27, не пересматривать)
- **Письмо.** Хаб писем не шлёт. HR заводит новичку корпоративную почту (Google) и сам пишет ему письмо со ссылкой на хаб и **общим стартовым паролем**.
- **Первый вход.** Новичок вводит свою почту и общий пароль на **обычной странице входа**. Хаб **сам создаёт учётку в статусе онбординга**, если одновременно:
  - пользователя с такой почтой нет;
  - почта на домене `trendsettercrew.com` (D1);
  - общий пароль верен;
  - не исчерпаны лимиты.

  Состояние новой учётки: `access_level = NULL`, отделов нет, `onboarding = true`, `must_change_password = true`, срок 14 дней.
- **Порядок шагов.**
  1. Сразу обязательная смена пароля. После неё общий пароль для этой почты больше не работает.
  2. Анкета (существующая «Моя анкета») и отправка HR.
- **До одобрения** виден только экран онбординга. Главной, Карты команды, меню модулей, колокольчика и профиля нет. При отказе HR новичок видит комментарий и исправляет анкету.
- **Одобрение.** HR одобряет анкету → онбординг снимается. Доступ назначает HR в диалоге одобрения (вариант А, раздел «Доступ при одобрении»).
- **Существующие учётки.** Для них общий пароль **не работает**. Исключение — учётка, созданная самим хабом по общему паролю, пока её владелец не сменил пароль и не истёк срок.
- **Срок** — 14 дней. Администратор продлевает ещё на 14.
- **Лимиты.**
  - 5 неудачных входов за 15 минут на почту, в том числе для самосоздания.
  - Не больше 20 самосозданий в сутки на систему, каждое пишется в журнал.
- **Администратор:**
  - есть кнопка «Завершить онбординг без анкеты»;
  - общий пароль меняет только он, на вкладке «Онбординг».
- Форма «Добавить пользователя» **не меняется**, чекбокса онбординга нет.
- Новых зависимостей нет.
- **Q-OB1…Q-OB10** закрыты, см. «Закрытые вопросы».

## Решения по умолчанию (lead, 2026-10-29; пересмотр — у пользователя, см. «Остаются открытыми»)
- **D1. Домен — константа.**
  - `SELF_REGISTER_DOMAIN = "trendsettercrew.com"` в `backend/app/core/onboarding.py`, по формулировке задачи «только для домена trendsettercrew.com».
  - Редактора доменов, столбца `email_domains`, `PATCH /admin/onboarding`, `ONBOARDING_DOMAINS_INVALID` и `ARRAY` **нет**.
  - Это меняет Q-OB2 («редактор остаётся»): нужно подтверждение пользователя.
- **D2. Формат почты для самосоздания** (строже `is_valid_email`). После `strip().lower()`:
  - вся почта не длиннее 254 символов;
  - ровно одна `@`;
  - локальная часть соответствует `^[a-z0-9._-]{1,64}$` — без `+` и не-ASCII: в Google `x+1@` доставляется в ящик `x@`;
  - домен в точности равен `SELF_REGISTER_DOMAIN`, поддомены не проходят.

  Не подходит → обычный 401, без отдельного текста.
- **D3. Ровно две проверки bcrypt на любом пути входа** — сравнение за постоянное время.
  - `/auth/login` всегда вызывает `verify_password` ровно два раза: общий хэш (или `DUMMY_HASH`) и личный хэш (или `DUMMY_HASH`). Результаты объединяются только после обоих вызовов.
  - Секреты в бэкенде сравниваются только через `bcrypt.checkpw` (`verify_password`), **никогда** через `==`. Простое сравнение допустимо только в mock.
  - Риск «по времени ответа видно онбординг», принятый в редакции 3, этим снят.
- **D4. Глобальный предохранитель от подбора общего пароля перебором почт.**
  - Неудачные входы по **несуществующим** почтам считаются в общем счётчике процесса: 30 за 15 минут (`UNKNOWN_EMAIL_FAILS_LIMIT = 30`).
  - При превышении самосоздание **молча** выключается до спада окна: «можно» = false, ответ обычный 401, обе проверки bcrypt выполняются как обычно. Отдельный 429 здесь не нужен: он выдал бы, какие почты существуют.
  - Существующих пользователей предохранитель не затрагивает.
  - `TODO(Q-S2)`: счётчик в памяти процесса.
- **D5. Новичок не видит чужую карточку.**
  - `team.get_me` для `user.onboarding` не ищет карточку: `person = null`, значения и фото карточки не отдаются, только своё из заявки и `email` учётки.
  - Иначе знающий общий пароль регистрирует почту коллеги без учётки и видит его ответы и фото.
  - `submit` для онбординга сохраняет найденный `person_id` в заявке, чтобы HR видел сравнение «было/стало». При этом карточку не привязывает, а обязательность `manager_claim` и наличие фото считает как для человека без карточки.
  - Меняет удобство из Q-OB8 (раньше анкета подставлялась из карточки): нужно подтверждение пользователя.
- **D6. Почта в анкете онбординга = почта учётки.** В `submit` для `user.onboarding` значение поля `email` (если поле есть) принудительно ставится равным `user.email`. Новичок не может записать в карточку чужую почту.
- **D7. `hr_users` не показывает онбординг-учётки** (`AND NOT u.onboarding`). HR не может привязать непроверенную учётку к карточке в обход одобрения.
- **D8. Админское «Завершить онбординг» — только после смены пароля.**
  - Если `must_change_password`, ответ 422 `ONBOARDING_PASSWORD_PENDING`.
  - Иначе остаётся состояние «уровень есть, пароль случайный, общий не действует (onboarding = false)», и войти невозможно.
  - Инвариант закрепляется в БД (D9).
- **D9. Инварианты в БД:**
  - `users_level_or_onboarding_check`: `CHECK (access_level IS NOT NULL OR onboarding)`;
  - `users_must_change_password_check`: `CHECK (NOT must_change_password OR onboarding)`.
- **D10. Общий пароль:** от **12** символов (не 10), не длиннее 72 байт и 128 символов.
- **D11. Память счётчиков входа.** Если в словаре по почтам больше 10 000 ключей, при записи неудачи сначала удаляются все устаревшие ключи. Случайные почты не раздувают память.
- **D12. T-OB4 закрыт.** Права `hub_app` на новую таблицу выдаются через `ALTER DEFAULT PRIVILEGES`, как у `0015`/`0016`. Явного `GRANT` нет, право проверяет тест в `test_database.py`.

## Сверка с кодом (2026-10-29; исправления ТЗ учтены ниже)
- **Нумерация.**
  - Было в ТЗ: «0012, после 0011; 0013 — предложка; ветка от `origin/main`».
  - Факт: `0012`/`0013` — WB «Маркировка» (`db/modules/wb/`), `0014`–`0016` — news-moderation, home-widgets, holidays. Файлов `db/12_*`, `db/13_*` нет, так и задумано.
  - Онбординг — `0017`.
- **`/auth/login` сейчас без лимита неудач** (лимит есть только у `change-password`, по `user.id`). Счётчик по почте — новый.
- **Проверки bcrypt на `/auth/login`.** Сейчас при ненайденной почте делается одна проверка на `DUMMY_HASH`. После D3 их будет две на любом пути.
- **`/auth/change-password`.**
  - Зависит от `get_current_user` → перевести на `get_authenticated_user`.
  - «Текущий пароль» сверяется только с личным хэшем; для онбординга добавить общий.
- **`/core/me`.**
  - Вызывает `run_daily_jobs` (остаётся без изменений).
  - Отдаёт `unread_notifications`: для онбординга — `0`.
  - Зависимость `get_current_user` → `get_authenticated_user`.
- **Кто на `get_current_user` напрямую** (по факту): `core/routes_core.py`, `core/routes_auth.py`, `modules/holidays`, `hr`, `news`, `team`, `wb`. Warehouse идёт через `require_module_run` и `module_responsible`, а они тоже на `get_current_user`. Проверка онбординга внутри `get_current_user` закрывает всё.
- **`access_level` с `NULL`** уже понимают `compute_module_access`, `_base_access`, `is_module_responsible`, `can_manage_users`. В модели `Mapped[str]` → `Mapped[str | None]`. Остальные чтения (`routes_admin`, `routes_core`, `hr/router`, `news/service`, `holidays/service`) передают значение в эти функции и не падают.
- **Анкета.**
  - Сейчас все пять маршрутов (`/me`, `/fields`, `POST`/`PATCH /me/submission`, `/me/submission/cancel`) на `Team = team_viewer` → `_team_access` → `get_current_user`.
  - Форма на фронте грузит `GET /modules/team/me` (`useMyProfile`) и `GET /modules/team/fields` (`useMyProfileForm`). Других запросов нет. `App.useApp()` берётся из `AntApp` в `main.jsx`, поэтому вне `AppLayout` форма работает.
- **`team.submit`** сразу привязывает найденную карточку (`UPDATE people SET user_id`). Для онбординга привязка переносится на одобрение.
- **`team.get_me`** через `resolve_own_person` (по `user_id`, по почте, по имени) отдаёт чужие значения карточки → D5.
- **`team.hr_users`** перечисляет всех активных, включая будущих новичков → D7.
- **`team.approve`.** Владелец заявки сейчас загружается только в одной ветке (`pid is None`). Для онбординга его надо загрузить сразу после проверки `pending`.
- **Справочник отделов для HR.** HR не администратор, `/admin/departments` ему закрыт → нужен `GET /modules/team/hr/departments`.
- **`conftest.clean`** делает `TRUNCATE users … CASCADE`. Это опустошит и `onboarding_settings` (FK `updated_by → users`) → в `clean` после TRUNCATE повторно выполнить `db/17_onboarding.sql`, по образцу повторов `04_`, `05_`, `07_`, `11_`.
- **`test_database.py`** ждёт версию `"0016"` в двух местах: `test_alembic_version_in_hub_schema` и конец `test_news_moderation_downgrade_keeps_pending_as_draft`. Оба → `"0017"`.
- **CORS:** `GET`/`POST`/`PATCH`, поэтому удаление онбординг-учётки делается через `POST`.
- **Внешние ключи на `users`** — `CASCADE` или `SET NULL`. Удаление онбординг-учётки безопасно: карточка отвязывается, заявки удаляются, журнал остаётся с `user_id = NULL`.
- **Фронт.**
  - `AppLayout` (`strings.levels[me.access_level]`), `ProfilePage`, `SettingsSection` новичку не показываются.
  - `UsersTab` (тег уровня) и `DemoUserSwitcher` должны показывать «—».
  - `LoginPage` после входа всегда ведёт на `/`, шлюз дальше уводит на `/onboarding`.
- **Слово «onboarding» в HR уже занято:** вид чек-листа в `hr/checklists.py` (`KINDS`) и автозапуск чек-листа `useAutoChecklist` в `SubmissionDrawer`. Новые действия журнала ядра — с приставкой `core.onboarding_*` и `user.onboarding_*`. Чек-листы HR не трогать.
- **Тестов-зеркал `messages.py` ↔ `strings.js` нет.** Поэтому строки фронта целиком идут в PR 2.
- **Регрессия проверена grep'ом:** в `test_me.py`, `test_admin.py`, `test_team.py`, `test_auth.py` нет сравнений ответов `/core/me`, `/admin/users`, `/hr/submissions`, `/hr/users` целиком (сравниваются отдельные ключи). Нет и 5+ неудачных входов на одну почту (циклы в `test_security.py` — по смене пароля). Новые поля и лимит входа существующие тесты не ломают.

## Правила безопасности (контракт)
1. **Самосоздание.** Учётка создаётся, только если одновременно:
   - общий пароль задан;
   - почта проходит D2;
   - пользователя с такой почтой нет (`lower(email)`);
   - предохранитель D4 не сработал;
   - общий пароль совпал;
   - лимит на почту не исчерпан;
   - суточный лимит не исчерпан.

   Почта сохраняется в нижнем регистре.
2. **Вход общим паролем в существующую учётку** возможен, только если `is_active`, `onboarding`, `must_change_password` и `onboarding_expires_at > now()`. Для остальных учёток он ничем не отличается от неверного пароля.
3. **После смены пароля** общий пароль для учётки больше не действует. Новый пароль не может совпадать с общим: 422 `NEW_PASSWORD_SAME`, проверка через `verify_password`.
4. **Срок** — 14 дней с создания (`ONBOARDING_TTL_DAYS`). Продление администратором возможно только до первой смены пароля.
5. **Лимит на почту:** 5 неудач за 15 минут → 429 `TOO_MANY_ATTEMPTS`.
   - Проверяется **до** любой проверки bcrypt.
   - Действует на **все** входы, включая несуществующие почты.
   - Ключ — `email.strip().lower()`.
   - Счётчик в памяти процесса, `TODO(Q-S2)`, очистка по D11.
6. **Суточный лимит самосозданий:** 20 за последние 24 часа на систему (`SELF_REGISTER_DAILY_LIMIT`).
   - Считается по журналу: действие `core.onboarding_self_register`, индекс `audit_log_action_at_idx` есть (`08_security.sql`).
   - Создание сериализуется `pg_advisory_xact_lock(SELF_REGISTER_LOCK)`: параллельные запросы не обходят лимит.
   - Превышение → 429 `ONBOARDING_LIMIT`. Этот ответ видит только тот, кто уже знает общий пароль.
7. **Отказы.** Все отказы входа, кроме двух 429, — один и тот же 401 `BAD_CREDENTIALS`. Нельзя отличить «нет пользователя», «чужой домен», «срок истёк», «регистрация выключена», «сработал предохранитель».
8. **Время ответа** — D3: ровно две проверки bcrypt на любом пути (кроме 429 до проверки).
9. **Нет повышения прав.**
   - Самосозданная учётка: `access_level NULL`, отделов, групп и особых прав нет.
   - Все маршруты, кроме белого списка, отвечают 403 `onboarding_required`.
   - HR выдаёт только `employee`/`viewer`/`superuser`.
   - Уровень и отделы существующих учёток через одобрение не меняются.
   - `admin` выдаёт только администратор.
   - `PATCH /admin/users/{id}` на онбординг-учётке онбординг **не снимает**.
10. **Журнал.** Пароли и хэши не пишутся ни в журнал, ни в ответы, ни в логи. Записываются действия:
    - `core.onboarding_self_register` (`user_id` новичка, без деталей с паролем);
    - `login` с деталью `onboarding_password: true`, если вход был общим паролем;
    - `core.password_change` с `onboarding_password: true`, если это смена на шаге «пароль»;
    - `core.onboarding_password_set` (кто задал, без значения);
    - `user.onboarding_extend`;
    - `user.onboarding_finish` (уровень и отделы, без ПДн);
    - `user.onboarding_delete` (`email`, `created_at`, `last_login_at` удалённой учётки — для разбора; пишется до удаления);
    - `team.approve` с `onboarding_done`, `access_level`, `department_ids`.

### Риски и как снижаются
- **Подтверждения владения почтой нет** (принято пользователем). Кто знает общий пароль, может зарегистрировать любую свободную почту домена. Снижение:
  - смена пароля обязательна сразу;
  - до одобрения ничего не видно (D5 — и чужой карточки тоже);
  - HR сверяет ФИО и фото с реальным человеком;
  - администратор удаляет онбординг-учётку, почта освобождается;
  - журнал хранит время, `user_id` и почту.
- **IP и устройство** в журнал не пишутся (Q-OB7).
- **Засыпать систему учётками.** Нужен общий пароль и почта домена, действуют лимиты 20 в сутки и 5 на почту, онбординг-учётка ничего не видит, лишние удаляются вручную (Q-OB10).
- **Подбор общего пароля.** Защищают D4, D10 и лимит на почту.
- **Утечка общего пароля.** Администратор меняет его. Новички, уже сменившие пароль, не затронуты.
- **Предохранитель D4 может временно не пустить настоящего новичка во время атаки:** он видит обычную ошибку и пробует через 15 минут или идёт к HR. Принимается.

## Доступ при одобрении (решение пользователя: вариант А)
- Если заявка от учётки на онбординге, в диалоге одобрения два поля:
  - «Уровень доступа» — обязательное, `employee`, `viewer` или `superuser` («руководитель»);
  - «Отделы» — любые, включая HR; можно пусто.
- `admin` выдаёт только администратор, позже, в обычной форме.
- **Принятый риск (решение пользователя).**
  - `superuser` даёт `run` на все модули.
  - Отделы дают `run` на модули отдела, в том числе HR с ПДн.
  - HR может выдать это без администратора.
  - Снижение: журнал `team.approve` с уровнем и отделами; администратор видит и меняет.
- Вариант Б («Ожидают роли» у администратора) отклонён.

**Помощник в ядре:** `backend/app/core/onboarding.py`, функция `finish_onboarding(session, user, access_level, department_ids, allowed_levels)`.
- Если уровень не в `allowed_levels`, ответ 422 `UNKNOWN_LEVEL`.
- Если отдел не существует, ответ 422 `UNKNOWN_DEPARTMENT`.
- Ставит уровень, заменяет отделы, `user.onboarding = False`.
- Вызывается:
  - из `team.approve` с `HR_LEVELS` (`employee`, `viewer`, `superuser`);
  - из админского `finish` с `ACCESS_LEVELS`.
- Коммит делает вызывающий код.
- Ядро не импортирует `modules/*`: `team` импортирует `core.onboarding`, а не наоборот.

## Модель состояния
Таблица `trendsetter_hub.users`:

| столбец | тип | смысл |
|---|---|---|
| `access_level` | было `NOT NULL`, станет **допускать `NULL`** | `NULL` — уровень ещё не назначен (только при `onboarding`) |
| `must_change_password` | `boolean NOT NULL DEFAULT false` | шаг «пароль» |
| `onboarding` | `boolean NOT NULL DEFAULT false` | доступ закрыт до одобрения или завершения администратором |
| `onboarding_expires_at` | `timestamptz NULL` | до какого момента общий пароль действует для этой учётки |

- Ограничения D9: `users_level_or_onboarding_check`, `users_must_change_password_check`. Существующий CHECK со списком уровней `NULL` пропускает.
- Существующие пользователи и все, кого создаёт администратор или CLI, получают `false`, `false`, `NULL`, уровень задан. Их ничего не касается.

Таблица ядра `trendsetter_hub.onboarding_settings` (ровно одна строка, создаётся миграцией):
- `id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1)`;
- `password_hash text NULL` — пока `NULL`, самосоздание и вход общим паролем выключены;
- `updated_at timestamptz NOT NULL DEFAULT now()`;
- `updated_by bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL`.

**Шаги:**
- `must_change_password` → шаг «пароль»;
- иначе `onboarding` → шаг «анкета» (подсостояние — `submission` из `GET /modules/team/me`);
- иначе обычный пользователь.

**Переходы:**
- `must_change_password`: ставится при самосоздании, снимается успешной сменой пароля.
- `onboarding`: ставится при самосоздании, снимается `team.approve` (через `finish_onboarding`) или администратором «Завершить», только при `not must_change_password` (D8).
- `onboarding_expires_at`: ставится при самосоздании (`now + 14 дней`), продлевает администратор, только при `must_change_password`.
- `reject` и `cancel_submission` ничего не меняют.

---

# PR 1 — бэкенд

## Данные
**`db/17_onboarding.sql`** (идемпотентно, шапка — см. «Номера»):
- `ALTER TABLE trendsetter_hub.users ALTER COLUMN access_level DROP NOT NULL`;
- `ADD COLUMN IF NOT EXISTS` для `must_change_password boolean NOT NULL DEFAULT false`, `onboarding boolean NOT NULL DEFAULT false`, `onboarding_expires_at timestamptz`;
- два ограничения D9, каждое в своём блоке `DO $$ … IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = … AND conname = …) …` (как в `10_news_color.sql`);
- `CREATE TABLE IF NOT EXISTS trendsetter_hub.onboarding_settings (…)`;
- `INSERT INTO trendsetter_hub.onboarding_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;
- явного `GRANT` нет (D12).

**`backend/alembic/versions/0017_onboarding.py`.** `downgrade` выполняется по шагам:
1. `UPDATE users SET is_active = false, access_level = 'viewer' WHERE access_level IS NULL` — открытых учёток без проверки не остаётся.
2. `DROP CONSTRAINT IF EXISTS` для обоих ограничений; `DROP COLUMN IF EXISTS` для трёх столбцов; `DROP TABLE IF EXISTS trendsetter_hub.onboarding_settings`.
3. `ALTER COLUMN access_level SET NOT NULL`.

**`deploy/stamp_alembic_0017.sql`** — две строки комментария и `UPDATE`:
- «-- Отмечает, что онбординг нового сотрудника уже применён (ревизия Alembic 0017).»
- «-- Выполнить один раз под doadmin в базе defaultdb ПОСЛЕ db/17_onboarding.sql и ДО merge в main.»
- `UPDATE trendsetter_hub.alembic_version SET version_num = '0017' WHERE version_num = '0016';`

**`db/README.md`** — раздел «Онбординг нового сотрудника (ревизия 0017)» после «Производственный календарь (ревизия 0016)», перед «Модуль «Склад»», в стиле `0014`–`0016`:
- что добавляет;
- права — автоматически;
- скрипт идемпотентен.

**Жирным** в разделе: новые столбцы ORM-модели `User` читаются на **каждом** запросе, включая `/auth/login`. Если код выкачен раньше SQL, весь хаб отвечает 500 и войти нельзя.

**Выкат 0017** (как у `0016`; `deploy.sh` миграции не выполняет):
1. Под doadmin в `defaultdb` выполнить `db/17_onboarding.sql` (после `db/16_holidays.sql`; `0014`–`0016` уже выкачены).
2. Под doadmin выполнить `deploy/stamp_alembic_0017.sql` (`0016` → `0017`).
3. Только после этого — merge в `main`.
4. **Общий пароль не задавать до выката PR 2.** Потом администратор задаёт его на вкладке «Онбординг». До этого самосоздание выключено.

**Откат** (`alembic downgrade 0016`): учётки без уровня отключаются и получают `viewer`, флаги, срок и общий пароль теряются.

**`backend/app/core/models.py`:**
- `User.access_level: Mapped[str | None]`;
- три новых поля: `Boolean` с `default=False, server_default="false"` и `DateTime(timezone=True)`, nullable;
- класс `OnboardingSettings`.

## Серверная блокировка (`backend/app/core/deps.py`)
Проверка ставится **внутрь `get_current_user`**. Сопоставлять `request.url.path` или проверять в каждом роутере **нельзя**.
```python
ONBOARDING_CODE = "onboarding_required"

class OnboardingRequired(HTTPException):
    def __init__(self) -> None:
        super().__init__(403, m.ONBOARDING_REQUIRED)

def get_authenticated_user(credentials=Depends(bearer), session=Depends(get_session)) -> User:
    ...  # нынешнее тело get_current_user без изменений

def get_current_user(user: User = Depends(get_authenticated_user)) -> User:
    if user.must_change_password or user.onboarding:
        raise OnboardingRequired()
    return user
```
- В `main.py` добавить `@app.exception_handler(OnboardingRequired)`, ответ `JSONResponse(403, {"detail": exc.detail, "code": ONBOARDING_CODE})`.
- `get_authenticated_user` используется **только** в трёх местах: `/core/me`, `/auth/change-password`, `own_profile_user`. Ревьюер проверяет grep'ом.

### Что разрешено новичку (полный список)
| маршрут | шаг «пароль» | шаг «анкета» | зависимость |
|---|---|---|---|
| `POST /auth/login`, `POST /auth/logout`, `GET /health` | да | да | без токена |
| `GET /core/me`, `POST /auth/change-password` | да | да | `get_authenticated_user` |
| `GET /modules/team/me`, `GET /modules/team/fields`, `POST`/`PATCH /modules/team/me/submission`, `POST /modules/team/me/submission/cancel` | 403 `onboarding_required` | да | `own_profile_user` |
| **всё остальное** | 403 `onboarding_required` | 403 `onboarding_required` | `get_current_user` |

### Тексты (`backend/app/core/messages.py`; зеркала в `strings.js` — в PR 2)
- `ONBOARDING_REQUIRED` — «Сначала завершите первый вход: смените пароль и отправьте анкету»
- `ONBOARDING_LIMIT` — «Регистрация новых сотрудников временно недоступна, обратитесь к HR»
- `ONBOARDING_PASSWORD_INVALID` — «Стартовый пароль: от 12 символов, не длиннее 72 байт»
- `ONBOARDING_NOT_ACTIVE` — «Пользователь не на онбординге»
- `ONBOARDING_EXTEND_NOT_ALLOWED` — «Продлить можно только до первой смены пароля»
- `ONBOARDING_PASSWORD_PENDING` — «Новичок ещё не сменил стартовый пароль»
- `ONBOARDING_LEVEL_REQUIRED` — «Выберите уровень доступа»

## Ядро: `backend/app/core/onboarding.py` (новый)
**Константы:**
- `SELF_REGISTER_DOMAIN = "trendsettercrew.com"`;
- `ONBOARDING_TTL_DAYS = 14`;
- `SELF_REGISTER_DAILY_LIMIT = 20`;
- `HR_LEVELS` — кортеж из `employee`, `viewer`, `superuser`;
- `SELF_REGISTER_LOCK = 70_007_002` — ключ advisory-блокировки, рядом с `DAILY_JOBS_LOCK = 70_007_001`;
- `SHARED_PASSWORD_MIN_LEN = 12`.

**Функции:**
- `settings_row(session) -> OnboardingSettings | None` — строка `id = 1`. **Нет строки = выключено, не 500.**
- `self_register_email_ok(email_key) -> bool` — правила D2.
- `shared_eligible(user) -> bool`: `user.is_active and user.onboarding and user.must_change_password and user.onboarding_expires_at is not None and user.onboarding_expires_at > now(UTC)`. bcrypt не вызывает.
- `shared_password_ok(session, user, password) -> bool`: возвращает `shared_eligible(user) and hash задан and verify_password(password, hash)`. Используется **только** в `change-password`; вход считает сам, D3.
- `self_register(session, email_key) -> User`:
  - `pg_advisory_xact_lock(SELF_REGISTER_LOCK)`;
  - счёт `core.onboarding_self_register` за 24 часа; если `>= SELF_REGISTER_DAILY_LIMIT`, ответ `HTTPException(429, ONBOARDING_LIMIT)`;
  - создание через ORM:
    - `email = email_key`;
    - `full_name` — локальная часть, обрезанная до 120 символов (временное имя, при одобрении заменится именем из анкеты);
    - `password_hash = hash_password(secrets.token_urlsafe(32))`;
    - `access_level = None`;
    - оба флага `True`;
    - срок `now + 14 дней`;
  - `flush`; при `IntegrityError` (почта успела появиться) — `rollback`, затем обычный 401 `BAD_CREDENTIALS`;
  - журнал `core.onboarding_self_register`.
- `finish_onboarding(...)` — см. «Доступ при одобрении».

## Вход (`backend/app/core/routes_auth.py`, `POST /auth/login`)
```
email_key = body.email.strip().lower()
с замком: неудач по email_key за 15 мин >= 5 → 429 TOO_MANY_ATTEMPTS          # до любых bcrypt
user = по lower(email) == email_key
s = settings_row(session); shared_hash = s.password_hash if s else None
если user:
    eligible = shared_hash is not None and shared_eligible(user)
    v_shared = verify_password(pw, shared_hash if eligible else DUMMY_HASH)     # bcrypt №1
    v_own    = verify_password(pw, user.password_hash)                          # bcrypt №2
    ok_shared = eligible and v_shared
    ok = user.is_active and (ok_shared or v_own)
иначе:
    can = shared_hash is not None and self_register_email_ok(email_key) and not предохранитель_D4_сработал
    v_shared = verify_password(pw, shared_hash if can else DUMMY_HASH)          # bcrypt №1
    verify_password(pw, DUMMY_HASH)                                             # bcrypt №2 — выравнивание
    ok = ok_shared = can and v_shared
    если ok: user = self_register(session, email_key)                           # 429 ONBOARDING_LIMIT / 401
неуспех → +1 к счётчику email_key; если почта не существует — +1 к счётчику D4; 401 BAD_CREDENTIALS
успех → сброс счётчика email_key, last_login_at, log_action login (onboarding_password=True только при ok_shared), commit, токен
```
- **Счётчики:**
  - отдельный словарь `_login_failures: dict[str, list[float]]` и список времени для D4 — рядом с `_failed_attempts`, тот же `_attempts_lock`, те же `MAX_FAILED_ATTEMPTS`/`ATTEMPT_WINDOW_SECONDS`;
  - комментарий `TODO(Q-S2)`;
  - очистка по D11.
- **`reset_password_attempts()`** очищает все три счётчика.
- **`verify_password`** вызывается через имя модуля `routes_auth`, импортированное как сейчас. Тест подменяет его через `monkeypatch` и считает вызовы.

## Смена пароля (`POST /auth/change-password`)
- Зависимость — `get_authenticated_user`.
- «Текущий пароль» принимается, если подходит личный **или** `shared_password_ok`.
- Если `user.must_change_password` и `shared_password_ok(session, user, new)` → 422 `NEW_PASSWORD_SAME`.
- При успехе:
  - `must_change_password = False`;
  - журнал `core.password_change` с `onboarding_password=True`, если флаг был установлен.
- Остальное как сейчас: 429, длины, `token_version`.

## `GET /core/me`
- Зависимость — `get_authenticated_user`.
- В ответ добавить `must_change_password` и `onboarding`.
- Пока любой флаг `true`, права не вычисляются:
  - `module_access` — все `"none"`;
  - `module_responsible` — все `false`;
  - `module_badges` — `{}`;
  - `unread_notifications` — `0`;
  - `can_manage_users` — `false`.
- `run_daily_jobs` — без изменений.

## Администрирование (`backend/app/core/routes_admin.py`, всё под `require_manager`)
- **`GET /admin/onboarding`** → `{"passwordSet": bool, "domain": "trendsettercrew.com", "updatedAt": iso|null, "updatedBy": "ФИО"|null, "ttlDays": 14, "dailyLimit": 20, "registeredToday": int}`. Хэша и пароля в ответе нет.
- **`POST /admin/onboarding/password`** `{password}`:
  - пароль от 12 символов, не длиннее 128 символов и 72 байт, иначе 422 `ONBOARDING_PASSWORD_INVALID`;
  - сохраняются хэш, `updated_at`, `updated_by`;
  - журнал `core.onboarding_password_set` без значения;
  - ответ — как у `GET`.
- **`POST /admin/users/{id}/onboarding/extend`:**
  - только при `onboarding and must_change_password`, иначе 422 `ONBOARDING_EXTEND_NOT_ALLOWED`;
  - срок `now + 14 дней`;
  - журнал `user.onboarding_extend`.
- **`POST /admin/users/{id}/onboarding/finish`** `{access_level, department_ids}`:
  - только при `onboarding`, иначе 422 `ONBOARDING_NOT_ACTIVE`;
  - при `must_change_password` → 422 `ONBOARDING_PASSWORD_PENDING` (D8);
  - `finish_onboarding(..., allowed_levels=ACCESS_LEVELS)`;
  - журнал `user.onboarding_finish`.
- **`POST /admin/users/{id}/onboarding/delete`:**
  - только при `onboarding`, иначе 422 `ONBOARDING_NOT_ACTIVE`; удалить себя нельзя;
  - журнал `user.onboarding_delete` с `email`, `created_at`, `last_login_at` пишется **до** удаления;
  - затем `session.delete(user)`.
- **`_public_user`** дополнительно отдаёт `must_change_password`, `onboarding`, `onboarding_expires_at` (iso|null). `access_level` может быть `null`.
- **Не менять:** `CreateUserBody`, `create_user`, `validation.py`, `reset_password`, `PatchUserBody`. `PATCH` с `access_level` на онбординг-учётке онбординг не снимает.

## Модуль team (`backend/app/modules/team/`)
**`router.py`:**
```python
def own_profile_user(user: User = Depends(get_authenticated_user), session: Session = Db) -> User:
    # Своя анкета: на шаге «анкета» — без проверки доступа к team (уровня ещё нет); остальным — как Team
    if user.must_change_password:
        raise OnboardingRequired()
    if user.onboarding:
        return user
    if not can_see_data(service.team_access(session, user)):
        raise HTTPException(403, m.FORBIDDEN)
    return user
```
- Пять маршрутов анкеты (`/me`, `/fields`, `POST`/`PATCH /me/submission`, `/me/submission/cancel`) перевести с `Team` на `Depends(own_profile_user)`. Для обычных пользователей поведение не меняется: та же проверка `can_see_data`. Остальные маршруты не трогать.
- `ApproveBody`: добавить `accessLevel: str | None = None`, `departmentIds: list[int] | None = None`.
- Новый `GET /hr/departments` под `Hr` → `[{id, name}]`, порядок по `id`.

**`service.py`:**
- **`get_me`** (D5): `pid = None if user.onboarding else resolve_own_person(session, user)`. Остальное без изменений.
- **`submit`:**
  - `pid = resolve_own_person(...)`, как сейчас, — для поля `person_id` заявки;
  - `card = None if user.onboarding else pid` — для `has_person` в `_clean` и проверки фото карточки;
  - для онбординга, если в `clean` есть ключ `email`, то `clean["email"] = user.email` (D6);
  - привязку `UPDATE people SET user_id` выполнять только при `not user.onboarding`.
- **`hr_users`** (D7): `WHERE u.is_active AND NOT u.onboarding`.
- **`list_submissions`:** в SELECT добавить `u.onboarding`, в ответ — `"userOnboarding": bool`.
- **`approve`.** Сразу после проверки `pending` загрузить `owner = session.get(User, sub["user_id"])`.
  - **Если `owner.onboarding`:**
    - **до любых записей** (сразу после загрузки `owner`): нет `accessLevel` → 422 `ONBOARDING_LEVEL_REQUIRED`; уровень не из `HR_LEVELS` → 422 `UNKNOWN_LEVEL`; несуществующий отдел → 422 `UNKNOWN_DEPARTMENT`. Иначе `CheckViolation` или ошибка после записи карточки попадёт в существующий `except IntegrityError` и превратится в 409 `MSG_EMAIL_DUPLICATE`;
    - после записи карточки и фото: `finish_onboarding(session, owner, d["accessLevel"], d.get("departmentIds") or [], HR_LEVELS)`;
    - `owner.full_name` = «Имя Фамилия» из `values` анкеты (`first_name`, `last_name`), если оба непустые; обрезать до 120;
    - в `log_action` для `team.approve` добавить `onboarding_done=True, access_level=…, department_ids=[…]`.
  - **Если не онбординг:** `accessLevel` и `departmentIds` **игнорируются** (проверяется тестом).
  - Всё в одной транзакции, коммит — существующий.
  - `_org_cols` читает только свои ключи, новые поля тела его не затрагивают.
  - Существующий 409 `MSG_USER_LINKED`, если у карточки другой `user_id`, не меняется. Это означает «у человека уже есть учётка»: HR отклоняет, администратор удаляет онбординг-учётку.
- **Не менять:** `reject`, `cancel_submission`, `resolve_own_person`.

## Чего на бэкенде не делать
- писем;
- показа или восстановления общего пароля;
- постоянной блокировки учёток;
- уведомлений, кроме существующего бейджа HR;
- автоудаления учёток;
- редактора доменов;
- изменений в `modules/hr/*` и `audit_view.py`;
- автодискавери.

## Тесты PR 1
**`backend/tests/test_onboarding.py` (новый).**
- Перед каждым тестом `reset_password_attempts()` (уже в `clean`).
- Общий пароль задаётся через `POST /admin/onboarding/password`.
- Почты вымышленные `@trendsettercrew.com`, люди вымышленные.

Регистрация и вход:
1. **Выключено по умолчанию.** Пароль не задан → вход новой почтой с любым паролем → 401, учётка не создана.
2. **Самосоздание.**
   - Почта `Ivan.Test@TrendsetterCrew.com` + общий пароль → 200 и токен.
   - В БД: почта `ivan.test@trendsettercrew.com`, `access_level IS NULL`, отделов нет, оба флага, срок ≈ 14 дней.
   - В журнале `core.onboarding_self_register` и `login` с `onboarding_password: true`.
   - Ни в одном `details` журнала нет пароля или хэша (поиск подстроки по `details::text`).
3. **Отказы — все 401 одним текстом, учётка не создана:**
   - чужой домен `example.com`;
   - поддомен `x.trendsettercrew.com`;
   - `a+b@trendsettercrew.com`;
   - не-ASCII локальная часть;
   - локальная часть из 65 символов;
   - неверный общий пароль;
   - некорректная почта.
4. **Существующие учётки:**
   - обычный пользователь + общий → 401;
   - отключённый новичок → 401;
   - новичок после смены пароля + общий → 401, личный → 200;
   - новичок с истёкшим сроком + общий → 401.
5. **Повторный вход** новичка до смены пароля общим паролем → 200, второй учётки нет.
6. **Лимит на почту.** 5 неудач → 6-я попытка 429 даже с верным паролем. Другая почта не затронута, несуществующая почта тоже получает 429 после своих 5 неудач.
7. **Суточный лимит.** Вставить в журнал 20 строк `core.onboarding_self_register` напрямую (без 20 живых входов — экономия bcrypt). Тогда 21-й живой вход → 429 `ONBOARDING_LIMIT`, учётка не создана. Если сдвинуть `at` этих строк на 25 часов назад, вход → 200: старые записи не считаются.
8. **Предохранитель D4.**
   - 30 неудач по 30 разным несуществующим почтам → новая почта с верным общим паролем получает 401, учётка не создана.
   - Существующий пользователь входит своим паролем → 200.
9. **Ровно две проверки bcrypt (D3).** `monkeypatch` `app.core.routes_auth.verify_password` счётчиком. Для каждого пути входа ровно 2 вызова:
   - неизвестная почта чужого домена;
   - неизвестная почта домена с неверным и с верным общим паролем;
   - обычный пользователь;
   - новичок до смены пароля;
   - отключённый.
10. **Ограничения БД.**
    - `UPDATE users SET onboarding = false WHERE access_level IS NULL` → `CheckViolation`.
    - Снять `onboarding` (с уровнем) у учётки с `must_change_password` → `CheckViolation`.

Онбординг:

11. **`/core/me` новичка:** флаги, все права `none`, бейджи `{}`, `unread_notifications == 0`, `can_manage_users == false`.
12. **Шаг «пароль».**
    - Анкета и `/fields` → 403 с `code == "onboarding_required"`.
    - Смена пароля: текущий = общий → 200, флаг снят, старый токен → 401.
    - Новый пароль = общий → 422.
13. **Шаг «анкета».**
    - `/modules/team/me`, `/fields`, отправка → 200.
    - `team_people.user_id` найденной по почте карточки **не** заполнен до одобрения.
    - Ответ `/modules/team/me` при существующей карточке с той же почтой: `person is None`, в `values` нет ответов карточки (D5).
    - `email` в сохранённой заявке = почта учётки, даже если прислана другая (D6).
    - `/modules/team/map` и `/core/notifications` → 403 `onboarding_required`.
14. **Обход всех маршрутов** — главный тест безопасности.
    - Перебор `app.routes`, все методы, параметры пути `1`, тело `{}`.
    - Для обоих шагов всё вне белого списка → 403 с `code == "onboarding_required"`; 422 или 404 — провал.
    - Белый список задан в тесте явно. Новый маршрут, не попавший ни в него, ни под шлюз, роняет тест.

Одобрение и администратор:

15. **Одобрение HR.**
    - Без `accessLevel` → 422, заявка остаётся `pending`.
    - `accessLevel: "admin"` → 422, несуществующий отдел → 422; после обоих карточка, фото и флаги не изменены. `superuser` → 200.
    - `employee` + отдел → 200, и после этого:
      - `onboarding == false`, уровень и отделы назначены;
      - `full_name` = «Имя Фамилия» из анкеты;
      - карточка привязана;
      - `/core/me` показывает права отдела;
      - `/modules/team/map` → 200;
      - в журнале `team.approve` с `onboarding_done`, `access_level`, `department_ids`.
16. **Одобрение обычного пользователя** с `accessLevel`/`departmentIds` в теле → уровень и отделы **не изменились**.
17. **Существующая карточка по почте** привязывается при одобрении. Если карточка уже занята другой учёткой → 409 `MSG_USER_LINKED`, флаги без изменений.
18. **Отказ HR:** онбординг остаётся, комментарий виден в `/modules/team/me`, повторная отправка → 200.
19. **Администратор.**
    - `extend`: истёкший срок → вход общим 200; после смены пароля → 422.
    - `finish`:
      - при `must_change_password` → 422 `ONBOARDING_PASSWORD_PENDING`;
      - после смены пароля `superuser` разрешён, онбординг снят, есть запись в журнале.
    - `delete`:
      - журнал с почтой, учётка и её заявка удалены;
      - почта снова регистрируется общим паролем;
      - на учётке не в онбординге → 422.
    - `POST /admin/onboarding/password` с 11 символами → 422.
    - `GET /admin/onboarding` не содержит хэша.
    - Не-admin → 403 на всех `/admin/onboarding*`.
20. **`GET /modules/team/hr/departments`:** HR → 200, не-HR → 403. **`GET /modules/team/hr/users`** не содержит онбординг-учётки.
21. **`list_submissions`** отдаёт `userOnboarding`.

**`backend/tests/test_database.py`:**
- `"0016"` → `"0017"` в `test_alembic_version_in_hub_schema` и в конце `test_news_moderation_downgrade_keeps_pending_as_draft`.
- Новые тесты по образцу `0015`/`0016`:
  - `test_app_role_can_use_onboarding_settings` — строка `id = 1` есть, `password_hash IS NULL`, `UPDATE` от `hub_app` проходит;
  - `test_onboarding_script_is_rerunnable_and_checks` — повторный прогон SQL дважды не падает, оба CHECK на месте;
  - `test_onboarding_downgrade_disables_unleveled_users` — вставить пользователя с `NULL` уровнем и `onboarding`, выполнить `alembic downgrade 0016`: `is_active = false`, уровень `viewer`, версия `0016`; в `finally` — `upgrade head`, версия `0017`.

**`backend/tests/conftest.py`:** в `clean` после TRUNCATE добавить одну строку — повтор `db/17_onboarding.sql`.

**Регрессия:** `test_auth.py`, `test_security.py`, `test_team.py`, `test_admin.py`, `test_me.py`, `test_hr*.py`, `test_news.py`, `test_holidays.py` должны быть зелёными **без изменений**. Если какой-то падает, тест не править: вернуть открытым вопросом.

## Файлы PR 1
**Новые:**
- `db/17_onboarding.sql`
- `backend/alembic/versions/0017_onboarding.py`
- `deploy/stamp_alembic_0017.sql`
- `backend/app/core/onboarding.py`
- `backend/tests/test_onboarding.py`

**Изменяемые (только описанное):**
- `db/README.md`
- `backend/app/core/models.py`, `deps.py`, `messages.py`, `routes_core.py` (`/core/me`), `routes_auth.py`, `routes_admin.py`
- `backend/app/main.py`
- `backend/app/modules/team/router.py`, `service.py` (`get_me` — одна строка, `submit`, `hr_users`, `list_submissions`, `approve`)
- `backend/tests/test_database.py`, `backend/tests/conftest.py`

---

# PR 2 — фронт и mock

## Вход
- `LoginPage.jsx` логику не меняет: самосоздание происходит на сервере в том же `POST /auth/login`.
- Единственная правка: в демо-режиме подсказка `strings.login.demoOnboardingHint` — «Новичок: onboarding@example.com и общий пароль Start-demo-2026».
- Комментарий `TODO(Q-D)` в `LoginPage` не трогать.

## Состояние и маршруты
- `frontend/src/core/auth/onboarding.js` (новый): `onboardingStep(me)` → `"password" | "profile" | null`. Тест — `onboarding.test.js`.
- `AppRoutes.jsx`:
  - внутри `RequireAuth` маршрут `onboarding` → `OnboardingPage`, **вне** `AppLayout`;
  - `AppLayout` обёрнут в `OnboardingGate`.
- `frontend/src/core/auth/OnboardingGate.jsx` (новый): если есть шаг → `Navigate to="/onboarding" replace`, иначе `Outlet`.
- `OnboardingPage` без шага → `Navigate to="/" replace`. После одобрения HR `syncMe` (60 с и фокус) обновит `me`, и переход произойдёт сам.

## Экран (`frontend/src/core/pages/OnboardingPage.jsx`, новый)
Без меню, колокольчика и профиля. `App.useApp()` доступен: `AntApp` стоит в `main.jsx`.
- **Шапка:** бренд, `me.email`, «Выйти».
- **Демо:** баннер и `DemoUserSwitcher`.
- **Шаги:** antd `Steps` — «Смена пароля», «Анкета и проверка HR».
- **Шаг `password`:**
  - пояснение «Придумайте свой пароль. Пароль из письма HR после этого перестанет работать»;
  - `ChangePasswordForm` с `onChanged={refreshMe}`.
- **Шаг `profile`:**
  - пояснение «Заполните анкету и отправьте HR. Доступ к хабу откроется после одобрения»;
  - кнопка «Проверить статус»: `refreshMe()` и пересоздание формы по `key`;
  - форма — `ONBOARDING_PROFILE_FORM` из `modules/registry.js` в `Suspense`.

## Админка
- `admin/AdminPage.jsx`: вкладка «Онбординг» (`admin/OnboardingTab.jsx`, новый).
- **`OnboardingTab.jsx`:**
  - статус: общий пароль задан или нет, когда и кем; «сегодня зарегистрировалось N из 20»; домен текстом;
  - форма «Новый общий пароль» + «Повторите»:
    - клиентская проверка от 12 символов;
    - поля очищаются после ответа;
    - значение нигде не показывается и не логируется;
  - памятка: пароль действует только для новых почт `@trendsettercrew.com`, до первой смены пароля и не дольше 14 дней.
- **`admin/UsersTab.jsx`:**
  - уровень `null` → «—» в таблице, в форме редактирования без значения;
  - в «Статус» тег «Онбординг» или «Онбординг: срок истёк» (если `must_change_password` и срок в прошлом);
  - в «Действия» для `onboarding`:
    - «Продлить» — только при `must_change_password`, с `Popconfirm`;
    - «Завершить онбординг» — только при `!must_change_password`; модалка: уровень (все четыре, обязательный) и отделы;
    - «Удалить онбординг-учётку» — `Popconfirm` «Почта освободится для повторной регистрации»;
  - форма «Добавить пользователя» **не меняется**.
- **`layout/DemoUserSwitcher.jsx`:** `strings.levels[u.access_level] ?? strings.dash`.

## HR (минимально)
- **`modules/hr/components/SubmissionDrawer.jsx`:** если `sub.userOnboarding`:
  - поля «Уровень доступа» (`employee`/`viewer`/`superuser`, обязательное) и «Отделы» (multiple, из `GET /modules/team/hr/departments`);
  - подсказка «Уровень admin назначает администратор»;
  - в тело approve — `accessLevel`, `departmentIds`.
  - Существующий автозапуск чек-листа HR (`useAutoChecklist`) не трогать.
- **`modules/hr/components/SubmissionsTab.jsx`:** тег «Новый сотрудник» при `userOnboarding`.
- **`modules/hr/strings.js`:** тексты для этих полей.

## Прочее
- `modules/registry.js`: экспорт `ONBOARDING_PROFILE_FORM` — `lazy`-импорт `./team/components/MyProfileSection.jsx`, по образцу соседних `lazy` в этом файле.
- `pages/ChangePasswordForm.jsx`: необязательный проп `onChanged`, после `setToken` — `await onChanged?.()`.
- `core/strings.js`:
  - зеркала новых текстов `messages.py` в `errors`, включая `onboardingRequired`;
  - разделы `onboarding`, `admin.onboarding`, `admin.users.*`;
  - `login.demoOnboardingHint`.
- **Не менять:** `AppLayout.jsx`, `access.js`, `client.js`, `transport.js`, `AuthProvider.jsx`, `RequireAuth.jsx`, фронтовый `modules/team/*`.

## Mock (демо-режим; не граница безопасности, простое сравнение паролей допустимо)
- **`mock/onboarding.js` (новый).** `withOnboardingGate(handlers, userFromToken)` — обёртка над **всеми** обработчиками:
  - `POST /auth/login`, `POST /auth/demo-login`, `GET /auth/demo-users`, `POST /auth/logout` пропускаются всегда;
  - без токена или с плохим токеном — исходный обработчик;
  - шаг «пароль» — `GET /core/me`, `POST /auth/change-password`;
  - шаг «анкета» — плюс пять маршрутов анкеты;
  - остальное — `ApiError` 403 с текстом `strings.errors.onboardingRequired`.
  - Там же `selfRegister` и `sharedPasswordOk` по правилам 1, 2, 6, D2. Домен — константа `MOCK_DOMAIN = example.com`: демо-пользователи на `example.com`.
- **`mock/data.js`:**
  - `onboarding` с полями `password` = `Start-demo-2026`, `updatedAt`, `updatedBy: 1`;
  - у пользователей флаги не добавлять (отсутствие = `false`);
  - заранее созданного новичка нет.
- **`mock/handlers.js`:**
  - объект → `raw`, экспорт `handlers = withOnboardingGate(raw, userFromToken)`;
  - `POST /auth/login` — общий пароль и самосоздание (журнал `audit.log`, суточный лимит);
  - `GET /core/me` — флаги и обнуление;
  - `GET`/`POST /admin/onboarding*` и три действия над пользователем (`finish` — 422 при `must_change_password`);
  - обёртка над `team.handlers` для approve: до вызова найти заявку через `GET /modules/team/hr/submissions?status=all` с тем же токеном. Если владелец на онбординге: без `accessLevel` → 422; после успеха — уровень, отделы, снять флаг, имя из анкеты;
  - обёртка над `GET /modules/team/hr/submissions` — добавляет `userOnboarding`;
  - `GET /modules/team/hr/departments`;
  - `team.js` **не трогать**.
- **`mock/auth.js`, change-password:** текущий пароль принимается и общий (`sharedPasswordOk`); после успеха `must_change_password = false`; новый не равен общему.
- **Доступ к team в mock.** В `createTeamHandlers` передать обёрнутый `accessTo`: для пользователя с `onboarding && !must_change_password` и модуля `team` → `view`, иначе исходный.
- **Допустимые расхождения mock с сервером** (отметить комментарием):
  - `team.js` может привязать карточку сразу при отправке;
  - `team.js` подставляет значения карточки (D5 в mock не повторяется).
- Если падает существующий mock-тест, тест **не править**: вернуть открытым вопросом.

## Тесты PR 2 (`npm test`)
- `core/auth/onboarding.test.js`: все сочетания флагов; ответ без флагов → `null`.
- `core/api/mock/onboarding.test.js`:
  - пропуски по шагам;
  - маршруты входа и выхода пропускаются с токеном новичка;
  - обычный пользователь не затронут;
  - самосоздание: домен, неверный пароль, существующая почта, суточный лимит;
  - сквозной сценарий через `createMockTransport(handlers)`: вход `onboarding@example.com` + общий → смена пароля → анкета → одобрение HR с уровнем → `/core/me` без флагов и с правами.

## Файлы PR 2
**Новые:**
- `frontend/src/core/auth/onboarding.js`, `onboarding.test.js`, `OnboardingGate.jsx`
- `frontend/src/core/pages/OnboardingPage.jsx`
- `frontend/src/core/admin/OnboardingTab.jsx`
- `frontend/src/core/api/mock/onboarding.js`, `onboarding.test.js`

**Изменяемые (только описанное):**
- `frontend/src/core/AppRoutes.jsx`, `pages/ChangePasswordForm.jsx`, `pages/LoginPage.jsx` (одна подсказка), `admin/AdminPage.jsx`, `admin/UsersTab.jsx`, `layout/DemoUserSwitcher.jsx`, `strings.js`
- `frontend/src/modules/registry.js`
- `frontend/src/modules/hr/components/SubmissionDrawer.jsx`, `SubmissionsTab.jsx`, `modules/hr/strings.js`
- `frontend/src/core/api/mock/handlers.js`, `auth.js`, `data.js`

---

## Не трогать (оба PR)
- `validation.py`, `validation.js`, `cli.py`, `access.py`, `audit.py`, `security.py`
- `backend/app/modules/hr/*` (включая чек-листы онбординга HR), `audit_view.py`, `news/*`, `warehouse/*`, `wb/*`, `holidays/*`
- существующие ревизии `0001`–`0016`, существующие `db/*.sql`, `db/modules/**`, `deploy/*` (кроме нового stamp)
- `mock/team.js`, фронтовый `modules/team/*`
- `AppLayout.jsx`, `access.js`, `client.js`, `transport.js`, `AuthProvider.jsx`, `RequireAuth.jsx`
- `package*.json`, `requirements.txt`, `vite.config.js`
- `ARCHITECTURE.md`, `CLAUDE.md`, другие `docs/*`
- репозиторий закупок

Если нужен другой файл — остановиться и вернуть вопрос.

## Проверка фактов
- **T-OB1** (обработчик подкласса `HTTPException` приоритетнее стандартного) и **T-OB2** (исключение под-зависимости раньше ошибок валидации тела и пути) закрываются тестами 12 и 14: `code == "onboarding_required"`, а не 422.
- **T-OB3** (antd 6: `Steps`, `Select`, `Form.useWatch`) — проверяется сборкой PR 2. `Form.useWatch` уже используется в `UsersTab` и `SubmissionDrawer`.
- **T-OB4** закрыт (D12) тестом `test_app_role_can_use_onboarding_settings`.
- **T-OB5** (`Mapped[str | None]` не ломает остальные места) — закрыт сверкой, раздел «Сверка с кодом»; регрессия — полный `pytest`.
- Отдельная проверка technical-analyst для старта PR 1 не нужна.

## Закрытые вопросы
**Пользователь, 2026-10-27:**
- Q-OB1 — вариант А.
- Q-OB2 — один домен `trendsettercrew.com`. Редактор снят по D1, нужно подтверждение.
- Q-OB3 — повторный вход общим паролем в пределах 14 дней.
- Q-OB4 — 20 в сутки.
- Q-OB5 — обычный 401.
- Q-OB6 — только окно 15 минут.
- Q-OB7 — без IP.
- Q-OB8 — сотрудники без учётки регистрируются. Подстановка карточки снята по D5, нужно подтверждение.
- Q-OB9 — без новых уведомлений.
- Q-OB10 — удаление только вручную.

**Lead, 2026-10-29:** D1–D12.

## Остаются открытыми (пользователю; не блокируют PR 1)
1. **D1 / Q-OB2.** Домен — константа без редактора. Если нужен второй домен или редактор, это отдельная доработка.
2. **D5 / Q-OB8.** Новичку на онбординге не подставляются данные существующей карточки (защита ПДн коллег). Сотрудник без учётки заполняет анкету с нуля, HR видит сравнение с карточкой. Вернуть подстановку — значит принять риск утечки данных карточки знающему общий пароль.
3. **D4.** Предохранитель 30 неудач по несуществующим почтам за 15 минут может временно не пустить настоящего новичка во время атаки. Устраивает ли порог.
4. **D8.** «Завершить без анкеты» — только после того, как новичок сменил пароль.
5. **Выключатель.** Нужна ли кнопка «Выключить самосоздание» (сброс общего пароля в `NULL`)? Сейчас её нет: при утечке пароль меняют.
6. **Q-S2.** Счётчики входа в памяти процесса. При нескольких процессах uvicorn лимиты действуют на процесс, а не глобально (действующий `TODO(Q-S2)`).

## План
1. SQL, ревизия `0017`, stamp, README, `models.py`, `conftest.py`, `test_database.py`. **Проверка:** `alembic upgrade head` и `downgrade 0016` на локальном Postgres, полный `pytest`.
2. `deps`/`messages`/`main`, `/core/me`, `core/onboarding.py`. **Проверка:** тесты 11, 14.
3. Вход, самосоздание, лимиты, D3/D4, смена пароля. **Проверка:** тесты 1–10, 12.
4. Админские эндпойнты. **Проверка:** тест 19.
5. team: `own_profile_user`, `get_me`, `submit`, `hr_users`, `list_submissions`, `approve`, `/hr/departments`. **Проверка:** тесты 13, 15–18, 20–21, регрессия. **Конец PR 1 → ревьюер.**
6. Фронт: шлюз, экран, вкладка «Онбординг», `UsersTab`, HR-диалог, строки. **Проверка:** `npm test`, `npm run lint`, `npm run build`.
7. Mock. **Проверка:** `npm test` и вручную в демо:
   - `onboarding@example.com` / `Start-demo-2026` → смена пароля → анкета;
   - HR одобряет с уровнем и отделом;
   - новичок видит главную и меню;
   - администратор: продлить, завершить, удалить. **Конец PR 2 → ревьюер.**

## ТЗ для исполнителя
- Строго по разделам этого документа, по PR. Трогать только файлы из «Файлы PR n».
- Перед стартом сверить номер ревизии (раздел «Номера»).
- Не добавлять зависимости и ничего сверх описанного: таблицы, эндпойнты, поля.
- Не менять форму и API ручного создания пользователя, `reset_password`, `reject`, `cancel_submission`, `resolve_own_person`.
- **Общий пароль:**
  - не логировать, не возвращать, не хранить открыто (кроме mock);
  - сравнивать только через `verify_password` (bcrypt), никогда через `==`;
  - на любом пути входа ровно два вызова `verify_password` (D3).
- Ответы входа на любые отказы одинаковы (401 `BAD_CREDENTIALS`), кроме двух 429: `TOO_MANY_ATTEMPTS` и `ONBOARDING_LIMIT`.
- SQL — через `text()` с параметрами. Изменения `User` — через ORM в той же транзакции.
- UI-строки — только в `core/strings.js` и `modules/hr/strings.js`.
- `TODO(Q-S2)` ставится у счётчиков входа. Других `TODO` по онбордингу нет.
- Неясное — вернуть открытым вопросом. Падающий существующий тест не править.
- Коммитить только явными путями. Ничего не пушить.

## Критерии приёмки для ревьюера

### PR 1
**Объём и миграция**
- [ ] Дифф только в файлах «Файлы PR 1». `CreateUserBody`, `create_user`, `reset_password`, `validation.*`, `access.py`, `security.py`, `modules/hr/*` не изменены.
- [ ] Номер `0017` (или следующий свободный), согласован везде: файл и `revision`/`down_revision="0016"`, `db/17_onboarding.sql` и `SQL_FILES`, шапка «ШАГ 17 … ПОСЛЕ 16_holidays.sql», `deploy/stamp_alembic_0017.sql` (`0016 → 0017`), `test_database.py` (два места), `conftest.py`, README.
- [ ] SQL идемпотентен (тест двойного прогона). Явного `GRANT` нет, права `hub_app` проверены тестом.
- [ ] Оба CHECK D9 в БД, есть тесты.
- [ ] `downgrade 0016` отключает учётки без уровня (тест), `upgrade head` возвращает.
- [ ] README: порядок выката `0014` → … → `0017`; жирное предупреждение про 500; «общий пароль не задавать до PR 2».

**Самосоздание, пароль, лимиты**
- [ ] Учётка создаётся только при выполнении всех условий правила 1 и D2: точный домен `trendsettercrew.com`, без `+`, ASCII, длины.
- [ ] Все отказы — один 401. 429 только `TOO_MANY_ATTEMPTS` (до bcrypt) и `ONBOARDING_LIMIT`.
- [ ] Ровно два `verify_password` на каждом пути входа (тест 9). В бэкенде нет `==` между паролями или хэшами.
- [ ] Лимит на почту действует на несуществующие почты. Предохранитель D4 отвечает 401, а не 429. Очистка словаря D11 есть.
- [ ] Суточный лимит считается по журналу под `pg_advisory_xact_lock`.
- [ ] Общий пароль не работает для обычных, отключённых, сменивших пароль и просроченных учёток (тесты).
- [ ] Хэш и значение общего пароля не попадают ни в один ответ, журнал или лог (тест по `details::text`, `GET /admin/onboarding`).

**Блокировка и права**
- [ ] Проверка онбординга — внутри `get_current_user`. `get_authenticated_user` используется только в `/core/me`, `/auth/change-password`, `own_profile_user` (grep).
- [ ] Тест обхода всех маршрутов есть и падает на неучтённом маршруте.
- [ ] `/core/me` в онбординге без прав, бейджей и непрочитанных.
- [ ] Новичок не видит данных чужой карточки (D5). Почта в заявке = почта учётки (D6). `hr_users` без онбординг-учёток (D7).
- [ ] HR выдаёт только `employee`/`viewer`/`superuser` (на `admin` 422, тест) и не меняет уровень и отделы существующих учёток (тест).
- [ ] Онбординг снимается только через `approve` или админский `finish`; `finish` — только после смены пароля.
- [ ] Карточка привязывается к онбординг-учётке только при одобрении.
- [ ] `extend`, `finish`, `delete` работают только для онбординг-учёток. `delete` пишет почту в журнал до удаления.
- [ ] Журнал содержит все действия правила 10.
- [ ] Полный `pytest` зелёный. Регрессионные файлы не изменены (кроме `test_database.py` и `conftest.py` по ТЗ).

### PR 2
- [ ] Дифф только в файлах «Файлы PR 2». `AppLayout`, `AuthProvider`, `client.js`, `access.js`, `mock/team.js`, фронтовый `modules/team/*` не изменены.
- [ ] Новичок на любом URL попадает на `/onboarding`: без меню, колокольчика и профиля, есть «Выйти», в демо — переключатель. После смены пароля шаг меняется сам, после одобрения — переход на главную.
- [ ] Ядро берёт анкету через `ONBOARDING_PROFILE_FORM`. Прямого импорта `modules/team` в `core/` нет.
- [ ] Вкладка «Онбординг» не показывает текущий пароль. Клиентская проверка от 12 символов, поля очищаются. Домен показан текстом, редактора нет.
- [ ] `UsersTab`:
  - «—» для `null`-уровня;
  - теги «Онбординг» и «Онбординг: срок истёк»;
  - «Продлить» только при `must_change_password`, «Завершить» только без него, «Удалить» только для онбординга;
  - форма добавления не изменена.
- [ ] HR-диалог: поля уровня (три значения) и отделов только для `userOnboarding`, тег «Новый сотрудник».
- [ ] Mock:
  - шлюз оборачивает все обработчики;
  - демо-сценарий с `onboarding@example.com` проходит целиком;
  - существующие mock-тесты не менялись;
  - расхождения mock отмечены комментариями.
- [ ] `npm test`, `npm run lint`, `npm run build` зелёные.
