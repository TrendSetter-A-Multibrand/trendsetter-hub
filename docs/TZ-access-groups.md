# ТЗ: группы доступа (WEEEK #18846)

Статус: утверждено пользователем 2026-10-19, ответы на Q-G1…Q-G6 — по рекомендациям lead. Ветка `dev-karen`. Код не написан.

## Цель
Админ создаёт группу, задаёт ей набор прав по модулям (`view` / `run` / `responsible`) и добавляет сотрудников. Права начинают действовать со следующего запроса, без перелогина. Текущая модель (уровни + отделы), существующие пользователи и тесты не ломаются.

## Что уже есть (факты из кода)
- В JWT только `sub`. `get_current_user` перечитывает пользователя из БД на каждом запросе; `require_module_run` (`deps.py`) тоже читает `user_departments` и `module_departments` на каждом запросе. **На сервере права «применяются сразу», если группы читаются из БД так же.** Проблема только во фронте: `me` грузится один раз (`AuthProvider.jsx`), а `refreshMe` при любой ошибке выкидывает пользователя (`clearToken`) — для фонового обновления не годится.
- Вычисление доступа продублировано: `routes_core.me` и `deps.require_module_run` (оба вызывают `compute_module_access`).
- ARCHITECTURE.md (раздел 5) называет зависимость `require_access(module_id, "view"|"run")`, в коде она `require_module_run`. Не переименовывать.
- ПИН ответственного Склада: `service.check_pin` сверяет с env `HUB_WAREHOUSE_PIN`, вызывается в `add_sector`, `remove_sector`, `import_old`. Фронт требует 4 цифры: `store.js` (`importOldFile`) и `components/Dialogs.jsx` (`SectorsBody.ok/remove`).
- `tests/test_database.py::test_alembic_version_in_hub_schema` проверяет версию `"0001"` — с новой ревизией правится на `"0002"`.
- `tests/conftest.py::clean` очищает таблицы через TRUNCATE — добавить `access_groups`.
- В `client.js` нет метода `delete`, CORS разрешает только `GET/POST/PATCH`. Удалений в проекте нет.
- `deploy.sh` миграции **не выполняет**, `/health` к БД не обращается. Слив в `main` до ручной миграции даст «зелёный» деплой и 500 на `/core/me`.

## Решения (утверждены)
1. **Группы только расширяют права (Q-G6: запрещающих нет).** Итог = максимум из базового (уровень + отделы) и группового; порядок `none < structure < view < run`. Групповое `view` даёт не ниже `view`; `run` и `responsible` дают `run`. Неактивный пользователь и неизвестный уровень получают `none`. Без групп результат для всех существующих случаев не меняется.
2. **Q-G1: группа поднимает и `viewer`.**
3. **`responsible` = `run` + отдельный флаг.** В `module_access` значение `responsible` НЕ добавляется (`canRun` проверяет `=== 'run'`). Флаг — отдельное поле `module_responsible: {module_id: bool}` в `/core/me`. **Q-G2: admin/superuser автоматически не ответственные.**
4. **Q-G3: «ИЛИ».** Ответственный по группе для `warehouse` выполняет действия «по ПИН» без ПИН; остальным с `run` ПИН нужен. `check_pin`, env `HUB_WAREHOUSE_PIN`, `config.py` не меняются. В демо (localStorage, без `VITE_API_URL`) ПИН нужен всегда.
5. **Группы — данные ядра:** три таблицы без приставки, одна ревизия Alembic `0002`, SQL в `db/02_access_groups.sql`.
6. **Q-G4: удаления групп нет.** Группу можно «обнулить» (убрать права и участников). DELETE, `client.delete`, правку CORS не добавлять.
7. **Q-G5:** тихое обновление `/core/me` на фронте: при возврате на вкладку и раз в 60 с. Сетевые ошибки игнорируются, 401 обрабатывает существующий механизм «сессия истекла».

`TODO(Q-Gn)` ставить в местах: Q-G1 — `access.py` и `access.js` у проверки групп; Q-G2 — `is_module_responsible` (py/js); Q-G3 — `warehouse/service.py` у пропуска `check_pin`; Q-G4 — `routes_admin.py` у роутов групп; Q-G5 — `AuthProvider.jsx`.

## Схема БД (`db/02_access_groups.sql`, выполняется под doadmin)
Идемпотентно (`IF NOT EXISTS`), только схема `trendsetter_hub`. Шапка-комментарий по образцу `01_core_hub.sql`.
```sql
CREATE TABLE IF NOT EXISTS trendsetter_hub.access_groups (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS access_groups_name_lower_key ON trendsetter_hub.access_groups (lower(name));

CREATE TABLE IF NOT EXISTS trendsetter_hub.access_group_permissions (
  group_id   bigint NOT NULL REFERENCES trendsetter_hub.access_groups (id) ON DELETE CASCADE,
  module_id  text   NOT NULL CHECK (module_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  permission text   NOT NULL CHECK (permission IN ('view', 'run', 'responsible')),
  PRIMARY KEY (group_id, module_id)
);

CREATE TABLE IF NOT EXISTS trendsetter_hub.access_group_members (
  group_id bigint NOT NULL REFERENCES trendsetter_hub.access_groups (id) ON DELETE CASCADE,
  user_id  bigint NOT NULL REFERENCES trendsetter_hub.users (id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS access_group_members_user_idx ON trendsetter_hub.access_group_members (user_id);

-- Явно, не полагаясь только на ALTER DEFAULT PRIVILEGES
GRANT SELECT, INSERT, UPDATE, DELETE ON trendsetter_hub.access_groups, trendsetter_hub.access_group_permissions,
  trendsetter_hub.access_group_members TO hub_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA trendsetter_hub TO hub_app;
```
- Одна строка на пару (группа, модуль); нет строки — нет права. Стартовых групп нет.
- Ревизия `backend/alembic/versions/0002_access_groups.py`: `revision="0002"`, `down_revision="0001"`; `upgrade()` выполняет `02_access_groups.sql` так же, как `0001` (`_sql_dir()` и `HUB_SQL_DIR`; хелпер скопировать, из 0001 не импортировать); `downgrade()` — `DROP TABLE IF EXISTS` для `access_group_members`, `access_group_permissions`, `access_groups` в этом порядке.
- **Прод (вручную, ДО merge в `main`).** Под doadmin в DBeaver, база `defaultdb`: (1) выполнить `db/02_access_groups.sql`; (2) `UPDATE trendsetter_hub.alembic_version SET version_num = '0002' WHERE version_num = '0001';` — оформить как `deploy/stamp_alembic_0002.sql` с комментарием по образцу `stamp_alembic.sql`. Порядок описать в `db/README.md`.

## API (все роуты под `require_manager`: 401 без токена, 403 не admin)
Форма группы: `{"id": 1, "name": "Ответственные склада", "permissions": {"warehouse": "responsible"}, "user_ids": [3, 8], "user_count": 2}`. `user_ids` отсортированы; `user_count` — число **активных** участников.

| Метод и путь | Тело | Ответ |
|---|---|---|
| `GET /admin/groups` | — | список групп по `id` |
| `POST /admin/groups` | `{name, permissions: {module_id: perm} = {}, user_ids: [] = []}` | группа |
| `PATCH /admin/groups/{id}` | `{name?, permissions?, user_ids?}`; переданное поле **заменяется целиком** | группа |

| Случай | Код | Текст (`messages.py` = `strings.js`) |
|---|---|---|
| имя пустое/пробельное | 422 | `Введите название группы` |
| имя > 64 символов | 422 | `Название группы не длиннее 64 символов` |
| дубль имени (без регистра, после `strip`; своё имя при PATCH допустимо) | 409 | `Группа с таким названием уже есть` |
| `module_id` нет в `app.core.registry.MODULES` | 422 | `Модуль не найден` |
| право не из `view`, `run`, `responsible` | 422 | `Неизвестное право` |
| `user_ids` с несуществующим пользователем | 422 | `Пользователь не найден` (константа `UNKNOWN_USER`) |
| группы `{id}` нет | 404 | `Группа не найдена` |
| `IntegrityError` на уникальности (гонка) | 409 | `Группа с таким названием уже есть` |
| неверный тип тела | 422 | `Некорректные данные` (глобально) |

Неактивных пользователей добавлять в группу можно (права у них всё равно `none`). Проверка имени: `validate_group_name(name, existing, self_id=None)` в `core/validation.py` по образцу `validate_department_name`; зеркало `validateGroupName` в `frontend/src/core/admin/validation.js`.

**Аудит** (`log_action` в той же транзакции): `group.create` — `group_id`, `name`, `permissions`, `user_ids`; `group.update` — `group_id` и только изменившееся: `name`; `permissions` (новая карта целиком); `added_user_ids`, `removed_user_ids` (отсортированные). PATCH без изменений пишет `group.update` только с `group_id`.

**`GET /core/me`**: новое поле `module_responsible: {<id каждого модуля из MODULES>: bool}`. Остальные поля не меняются; `module_access` по-прежнему `none|structure|view|run`.

## ТЗ для исполнителя

### Общие правила
- Строго по ТЗ. Неясное — вернуть открытым вопросом. `TODO(Q-Gn): <кратко>` в местах выше.
- Без новых зависимостей, TypeScript, i18n, Redis. Не трогать `create_all`, DDL при старте, `vite.config.js`.
- Строки ядра — `frontend/src/core/strings.js`, Склада — `frontend/src/modules/warehouse/strings.js`.
- Существующие тесты не ослаблять. Разрешённые правки: `test_database.py` (`0001` → `0002`), `conftest.py::clean` (добавить `trendsetter_hub.access_groups` в TRUNCATE).

### Файлы, которые можно менять или создавать
Backend и БД: `db/02_access_groups.sql` (новый), `db/README.md`, `deploy/stamp_alembic_0002.sql` (новый), `backend/alembic/versions/0002_access_groups.py` (новый), `backend/app/core/{models,access,deps,routes_core,routes_admin,messages,validation}.py`, `backend/app/modules/warehouse/{router,service}.py` (только пропуск ПИН для ответственного и поле `via` в журнале), `backend/tests/{conftest,test_access,test_database,test_groups,test_warehouse}.py` (в существующих — только новые тесты и две разрешённые правки).

Frontend: `frontend/src/core/{access.js,access.test.js,strings.js}`, `core/admin/{AdminPage.jsx,GroupsTab.jsx (новый),UsersTab.jsx (только колонка «Группы»),validation.js,validation.test.js}`, `core/auth/AuthProvider.jsx`, `core/api/mock/{data.js,handlers.js}`, `modules/warehouse/{components/Dialogs.jsx,store.js,strings.js,README.md}`.

Документация: `ARCHITECTURE.md` — только раздел 5 (абзац «Группы доступа», ссылка на `module_responsible`).

### Нельзя менять
`CLAUDE.md`, `backend/app/config.py`, `backend/app/main.py` (CORS), `backend/alembic/versions/0001_baseline.py`, `backend/alembic/env.py`, `db/01_core_hub.sql`, `db/modules/**`, `deploy/deploy.sh`, `deploy/stamp_alembic.sql`, `.github/**`, `frontend/src/core/api/client.js`, `core/api/http/**`, `modules/registry.js`, `modules/warehouse/lib/**`, `core/pages/**`, `core/layout/**`, сама функция `check_pin`, все существующие тест-кейсы, репозиторий purchasing_dashboard.

### Этап 1 — БД, бэкенд, тесты
**1.1. SQL и ревизия** — как в разделе «Схема БД». Вручную проверить `alembic downgrade 0001 && alembic upgrade head` на локальной БД из compose.

**1.2. Модели** (`models.py`): `AccessGroup`, `AccessGroupPermission`, `AccessGroupMember` по стилю `UserDepartment`/`ModuleDepartment`, явные FK `f"{SCHEMA}...."`. `AccessGroup`: `id`, `name`, `created_at` (server_default).

**1.3. Чистые функции** (`access.py`), существующие ветки не переставлять:
```python
ACCESS_ORDER = ("none", "structure", "view", "run")
GROUP_PERMISSIONS = ("view", "run", "responsible")

def compute_module_access(*, access_level, is_active, department_ids, module_department_ids,
                          group_permissions: Iterable[str] = ()) -> str:
    # base — прежняя логика; если base == "none" (неактивен/неизвестный уровень) — вернуть "none"
    # granted: "run" если есть "run" или "responsible"; иначе "view" если есть "view"; иначе "none"
    # TODO(Q-G1): группа поднимает и viewer
    # вернуть максимум(base, granted) по ACCESS_ORDER

def is_module_responsible(*, access_level, is_active, group_permissions: Iterable[str]) -> bool:
    # True только если is_active, access_level in ACCESS_LEVELS и "responsible" in group_permissions
    # TODO(Q-G2): admin/superuser автоматически не ответственные
```
Неизвестные значения прав игнорируются.

**1.4. Единое чтение прав** (`deps.py`):
```python
def module_rights(session, user, module_ids: list[str]) -> dict[str, tuple[str, bool]]:
    """{module_id: (access, responsible)}; читается из БД на каждый вызов."""
```
Запросы: `user_departments` пользователя; `module_departments` для `module_ids`; `access_group_permissions JOIN access_group_members` по `user_id` и `module_id IN module_ids`. `require_module_run(module_id)` переписать через `module_rights` (поведение и тексты 403 не меняются). Новая фабрика `module_responsible(module_id)` — зависимость, возвращает `bool`, исключений не бросает.

**1.5. `/core/me`** (`routes_core.py`): `module_access` и `module_responsible` через `module_rights(session, user, [m.id for m in MODULES])`. Остальное не менять.

**1.6. Роуты групп** (`routes_admin.py`, секция `# ---------- группы доступа ----------`): по разделу «API». Хелперы по образцу `_check_department_ids`/`_set_departments`: `_check_user_ids`, `_check_permissions`, `_set_permissions`, `_set_members`, `_group_out`. `# TODO(Q-G4): удаление групп не реализовано — группу можно обнулить`.

**1.7. Склад** (`router.py`, `service.py`): в `router.py` `Responsible = Depends(module_responsible(service.MODULE_ID))`; эндпоинты `/sectors` (POST), `/sectors/remove`, `/import` получают `responsible: bool = Responsible` и передают в сервис. В `service.py` `add_sector`, `remove_sector`, `import_old` получают последний параметр `responsible: bool = False`; вместо `check_pin(pin)` — `if not responsible: check_pin(pin)` с `# TODO(Q-G3): ответственный по группе проходит без ПИН`. В `log_action` этих действий добавить `via="group" if responsible else "pin"`; если `import_old` не пишет в журнал — `log_action` не добавлять, сообщить в отчёте. Правило `Run` (403 без права запуска) не меняется. В docstring `router.py` обновить фразу о доступе («…или участник группы с правом запуска»).

**1.8. Тесты.**
- `conftest.py::clean`, `test_database.py` (`0002` + проверка INSERT под `hub_app` в три новые таблицы по образцу `test_app_role_can_use_warehouse_objects`).
- `test_access.py`: новые случаи 17–27 и R1–R6 (таблица ниже); существующие `CASES` не менять; тест, что `group_permissions` по умолчанию `()`.
- `test_groups.py` (новый): только admin (superuser/employee → 403, без токена → 401 на все три метода); создание с правами и участниками, формат ответа, `user_count` только активных, аудит `group.create` = 1; все строки таблицы ошибок с точными текстами и кодами; PATCH: замена `user_ids` и `permissions` целиком, переименование в своё имя допустимо, аудит с `added_user_ids`/`removed_user_ids`; **немедленное действие**: токен `viewer` получен ДО добавления в группу → `GET /modules/warehouse/receipts` 403; админ добавляет в группу `{warehouse: run}` → с ТЕМ ЖЕ токеном 200 и `/core/me.module_access.warehouse == "run"`; PATCH `user_ids=[]` → тем же токеном снова 403; смена прав группы `run` → `view` у участника-employee другого отдела сразу даёт 403 на Склад и `view` в `/core/me`; отключённый участник группы получает 401, группы его не оживляют.
- `test_warehouse.py`, только новые: сотрудник Закупок в группе `{warehouse: responsible}`: `POST /sectors` с `pin: ""` не получает 403 «Неверный ПИН», в `audit_log` для `warehouse.sector_add` `details->>'via' = 'group'`; то же при `monkeypatch.delenv("HUB_WAREHOUSE_PIN")` — ответственный проходит, неответственный `wh` получает 403 «не настроен» (существующее поведение); `/core/me.module_responsible == {"warehouse": True, остальные False}` для ответственного, для admin без групп все `False`.

Новые случаи (одинаковые в `test_access.py` и `access.test.js`, номера общие):
| # | пользователь | отделы модуля | права групп | ожидание |
|---|---|---|---|---|
| 17 | viewer, [] | [1] | [view] | view |
| 18 | viewer, [] | [1] | [run] | run |
| 19 | employee, [2] | [1] | [view] | view |
| 20 | employee, [2] | [1] | [run] | run |
| 21 | employee, [2] | [1] | [responsible] | run |
| 22 | employee, [1] | [1] | [view] | run (группа не понижает) |
| 23 | employee, [1], неактивен | [1] | [run] | none |
| 24 | уровень `boss`, [1] | [1] | [run] | none |
| 25 | superuser, [] | [1] | [view] | run |
| 26 | viewer, [] | [1] | [view, run] | run |
| 27 | viewer, [] | [1] | [] | structure |
| R1 | employee, активен | — | [responsible] | responsible = true |
| R2 | employee, активен | — | [run] | false |
| R3 | admin, активен | — | [] | false (Q-G2) |
| R4 | employee, неактивен | — | [responsible] | false |
| R5 | viewer, активен | — | [responsible] | true (Q-G1) |
| R6 | уровень `boss` | — | [responsible] | false |

**Verify этапа 1:** `docker compose up -d postgres`, `pytest` в `backend/` (или в контейнере `api`) — все тесты зелёные (старые без изменения кейсов + новые); вручную `alembic upgrade head` → `downgrade 0001` → `upgrade head`.

### Этап 2 — фронтенд, моки, Склад, обновление `me`
**2.1. `access.js` / `access.test.js`**: `computeModuleAccess(user, moduleDepartmentIds, groupPermissions = [])` — та же логика, что в 1.3, с `TODO(Q-G1)`; `isModuleResponsible(user, groupPermissions = [])`; `export const GROUP_PERMISSIONS = ['view', 'run', 'responsible']`; в тесты случаи 17–27 и R1–R6, существующие 16 не менять.

**2.2. `strings.js`**: `admin.tabGroups: 'Группы доступа'`; блок `admin.groups` (колонки `name: 'Название'`, `permissions: 'Права'`, `userCount: 'Сотрудников'`; `add: 'Добавить группу'`, `edit: 'Изменить'`, `addTitle`, `editTitle`, `members: 'Сотрудники'`, `membersPlaceholder: 'Выберите сотрудников'`, `modulesTitle: 'Права по модулям'`, `noPermissions: 'Нет прав'`, `created: 'Группа добавлена'`, `updated: 'Группа обновлена'`, `hint: 'Права группы добавляются к уровню и отделам сотрудника и действуют сразу'`, `disabledUser: (name) => \`${name} (отключён)\``); `permissions: { none: 'Нет', view: 'Просмотр', run: 'Запуск', responsible: 'Ответственный' }`; `admin.users.groups: 'Группы'`; `admin.validation`: `groupNameEmpty`, `groupNameTooLong`, `groupNameDuplicate`; `errors`: `groupNotFound`, `unknownModule`, `unknownPermission`, `unknownUser` — тексты дословно как в таблице ошибок API.

**2.3. `validation.js` / `validation.test.js`**: `validateGroupName(name, existing, selfId)` — зеркало серверной; тесты: пустое, пробелы, длина 65, дубль без регистра, своё имя при редактировании.

**2.4. `GroupsTab.jsx`** (по образцу `DepartmentsTab.jsx`): таблица (Название; Права — теги «<название модуля>: <право>» по порядку `MODULES` из `modules/registry.js`, без прав — `noPermissions`; Сотрудников; Действия — «Изменить»); кнопка «Добавить группу» → модалка: «Название», блок «Права по модулям» (на каждый модуль `Select`: Нет / Просмотр / Запуск / Ответственный; «Нет» в `permissions` не попадает), «Сотрудники» (`Select mode="multiple"`, отключённые помечены `disabledUser`, поиск по ФИО), подсказка `hint`. Клиентская проверка `validateGroupName`, ошибки сервера через `message.error(e.message)`. После сохранения `reload()` и `syncMe()`.

**2.5. `AdminPage.jsx`**: грузить `/admin/groups` вместе с пользователями и отделами; вкладка `groups`; `groups` в `UsersTab`.

**2.6. `UsersTab.jsx`**: колонка «Группы» только для чтения (теги названий групп, где `user_ids` содержит пользователя, иначе `strings.dash`). Модалку пользователя не менять.

**2.7. `AuthProvider.jsx`** (`TODO(Q-G5)`): `syncMe` — если токена нет, ничего; `api.get('/core/me')`; при успехе `setMe` только если `JSON.stringify` отличается; при ошибке ничего не делает, токен не очищать (401 уже обрабатывает `client.js`). Вызовы: `visibilitychange` (вкладка видима), `window` `focus`, `setInterval` 60 000 мс пока есть `me`; подписки и таймер снимаются при размонтировании. `syncMe` в значение контекста. `refreshMe`, `login`, `logout` не менять.

**2.8. Моки**: `data.js` — `groups: [{ id: 1, name: 'Ответственные склада', permissions: { warehouse: 'responsible' }, user_ids: [8] }]`, `nextId.group = 2`; Наблюдателя (id 5) в демо-группы не добавлять. `handlers.js` — хелпер `groupPermissionsOf(user, moduleId)`; `accessTo` передаёт его третьим аргументом; `GET /core/me` возвращает `module_responsible`; роуты `GET/POST /admin/groups`, `PATCH /admin/groups/:id` с теми же проверками, кодами и текстами, что на сервере; `user_count` — только активные; `GET /admin/departments` не трогать.

**2.9. Склад** (`Dialogs.jsx`, `store.js`, `strings.js`): в `Dialogs.jsx` `const pinFree = Boolean(API_URL) && me?.module_responsible?.warehouse === true` (`useAuth`, `API_URL` из `core/config.js`; в демо ПИН нужен всегда). При `pinFree`: в `SectorsBody` и `MoreBody` поле ПИН не показывается, вместо него подсказка `strings.dialogs.pinNotNeeded = 'ПИН не нужен: вы ответственный склада'` (в `warehouse/strings.js`), проверка `/^\d{4}$/` пропускается, на сервер уходит `pin: ''`. `store.js`: `importOldFile(file, pin, pinFree = false)` — проверка ПИН только при `!pinFree`. `warehouse/strings.js` — только новая строка (`noRun` не трогать, неточность упомянуть в отчёте). `warehouse/README.md` — раздел «ПИН ответственного»: фраза про группу с правом «Ответственный».

**2.10. Документация**: `ARCHITECTURE.md` раздел 5 — абзац «Группы доступа» (три таблицы, правило максимума, `module_responsible`, ссылка на Q-G1…Q-G6); `db/README.md` — описание таблиц и **порядок выката**: (1) под doadmin `db/02_access_groups.sql`; (2) `deploy/stamp_alembic_0002.sql`; (3) только затем merge в `main`.

**Verify этапа 2:** в `frontend/`: `npm test`, `npm run lint`, `npm run build` зелёные. Вручную в демо (`VITE_DEMO_MODE=true`): создать группу «Склад: смена» (Закупки = Просмотр, Склад = Запуск) с «Сотрудник WB» → вход за него: Склад открывается на приёмку; убрать из группы, вернуться во вкладку «Сотрудник WB» (или подождать 60 с): Склад «только просмотр».

### Отчёт исполнителя
Вывод `pytest`, `npm test`, `npm run lint`, `npm run build`; список изменённых и созданных файлов; все поставленные `TODO(Q-Gn)`; отклонения от ТЗ и найденное, но не исправленное.

## Риски
- **Выкат до миграции:** `/core/me` и роуты Склада дают 500 при зелёном `/health`. Смягчение — порядок в `db/README.md`.
- Модуль удалён из `MODULES`, права остались в БД: API их не принимает, `module_rights` их не запрашивает, UI показывает только модули реестра.
- `ON DELETE CASCADE` в членстве и правах; пользователей не удаляют, только отключают.
- На каждый запрос к модулю +1 SELECT с JOIN по индексам — несущественно.
- Фоновый `syncMe`: `setMe` только при реальном изменении. Если сотрудник потерял доступ посреди работы, очередь сканов (`store.js`, вне React) не теряется, но не отправится (403) — допустимо, отметить в отчёте.

## План
1. **Этап 1** — БД и бэкенд (1.1–1.8).
2. **Этап 2** — фронтенд и документация (2.1–2.10).
3. **Выкат (пользователь):** под doadmin выполнить `02_access_groups.sql` и `stamp_alembic_0002.sql`, затем merge в `main`.

## Критерии приёмки для ревьюера
- `pytest` зелёный; 16 старых случаев в `test_access.py`/`access.test.js` не изменены, добавленные 17–27 и R1–R6 совпадают в обоих файлах.
- Диффы существующих тестов: только `conftest.py::clean` и версия `0002` в `test_database.py`.
- `compute_module_access` без `group_permissions` возвращает прежнее; группы только повышают; неактивный и неизвестный уровень дают `none`.
- В `module_access` нет значения `responsible`; флаг только в `module_responsible`, ключи — все id из `MODULES`.
- Права читаются из БД на каждый запрос, в JWT ничего не добавлено; есть тест 403 → 200 → 403 на одном токене.
- Логика прав в одном месте (`deps.module_rights`), используется `require_module_run`, `/core/me`, `module_responsible`; дублей в `routes_core.py` нет.
- Миграция: одна ревизия `0002`, SQL в `db/02_access_groups.sql`, таблицы без приставки, `CHECK`, `ON DELETE CASCADE`, явные `GRANT`; нет `create_all` и DDL в коде приложения; тесты под `hub_app` проходят.
- `deploy/stamp_alembic_0002.sql` есть; в `db/README.md` порядок «SQL → stamp → merge»; `deploy.sh`, `.github/**`, `main.py`, `config.py` не изменены.
- API: пути, коды, тексты — по таблицам; тексты одинаковы в `messages.py` и `strings.js`; только admin; DELETE нет.
- Аудит: `group.create`/`group.update` в одной транзакции, в `update` есть `added_user_ids`/`removed_user_ids`; действия Склада пишут `via` = `pin`/`group`.
- ПИН: `check_pin`, `HUB_WAREHOUSE_PIN`, `config.py` не изменены; неответственный по-прежнему получает 403; ответственный проходит без ПИН, в том числе когда env не задан.
- Фронт: `npm test`/`lint`/`build` зелёные; нет новых зависимостей и TypeScript; строки в `strings.js`; `syncMe` не выкидывает пользователя и не очищает токен, подписки снимаются, `setMe` только при изменении.
- Моки повторяют контракт сервера; демо «Наблюдатель» не изменился; в демо ПИН нужен всегда.
- Склад: у ответственного с бэкендом нет поля ПИН и клиентской проверки 4 цифр, у остальных как было.
- Спорные места помечены `TODO(Q-G1…Q-G5)`; вне списка разрешённых файлов изменений нет.
