# ТЗ: новости, этап 3 — предложка, модерация и раздел «Редактор новостей» (+ закрепление, порядок, виджеты главной)

Статус: lead, 2026-10-27; **актуализировано 2026-10-29** по `main` @ `798e8d0` (после PR #39). Решения пользователя по Q-NM1, Q-NM2, Q-NM5, Q-NM7, Q-NM8, Q-NM9 приняты; остальные Q-NM закрыты решениями по умолчанию (раздел «Закрытые вопросы»); T-NM1…T-NM3 закрыты тестами (раздел «Проверка фактов»), отдельная проверка technical-analyst для старта PR 1 не нужна. Опирается на `docs/TZ-news.md` (модуль `news`, миграции 0009/0010, PR #26, #27): его решения и контракт действуют, здесь только дополнения. Открытые вопросы — `Q-NM*` (префикс `Q-M*` занят складом); в коде — `TODO(Q-NMn)`.

## Ветка и коммиты (решение пользователя 2026-10-29)
- Работа идёт в локальной ветке **`news-moderation`** (создана от `origin/main` @ `798e8d0`). **Ничего не пушить.** Другие ветки не создавать и не переключать.
- **PR 1** и **PR 2** — две последовательные серии коммитов в этой ветке: сначала PR 1 целиком (и его приёмка ревьюером), потом PR 2 поверх (ревизия PR 2 зависит от ревизии PR 1).
- Ветку не ребейзить и не мержить `main` без команды пользователя.

## Номера миграций и SQL-файлов
Последняя ревизия в `main` — **`0013`** (`0012`, `0013` — WB «Маркировка», SQL в `db/modules/wb/`). Этому ТЗ принадлежат:

| PR | Ревизия Alembic | `down_revision` | SQL | Отметка версии |
|---|---|---|---|---|
| PR 1 | `backend/alembic/versions/0014_news_moderation.py` | `"0013"` | `db/14_news_moderation.sql` | `deploy/stamp_alembic_0014.sql` (`0013 → 0014`) |
| PR 2 | `backend/alembic/versions/0015_home_widgets.py` | `"0014"` | `db/15_home_widgets.sql` | `deploy/stamp_alembic_0015.sql` (`0014 → 0015`) |

**Правила нумерации (по образцам `0009`–`0013`):**
- Ревизия: `NNNN_<суть>.py`, `revision = "NNNN"`, `down_revision` = предыдущая; тело — по схеме `0011_gender_field.py` (`SQL_FILES`, `_sql_dir()` с `HUB_SQL_DIR`, выполнение скрипта в `upgrade`), докстринг в том же формате («Выполняет db/… В боевой базе скрипт и отметка версии выполняются вручную под doadmin (…, затем deploy/stamp_alembic_NNNN.sql) до слияния кода в main.»).
- SQL ядра и новостей лежит в корне `db/`, и **номер файла = номер ревизии** (`09_news.sql`↔`0009`, `10_news_color.sql`↔`0010`, `11_gender_field.sql`↔`0011`). Скрипты модулей с собственной приставкой таблиц — в `db/modules/<id>/NNN_*.sql` (как `wb`: `0012`↔`modules/wb/001_…`, `0013`↔`modules/wb/002_…`). Таблицы `news_*` исторически в корне — продолжаем в корне. Поэтому файлов `db/12_*`, `db/13_*` нет — это нормально.
- Шапка SQL — как у `10_news_color.sql`: «-- ШАГ 14. … (ревизия Alembic 0014).» / «-- Выполнять под doadmin, подключившись к базе defaultdb ПОСЛЕ modules/wb/002_wb_marking_imported.sql. Скрипт можно запускать повторно.» (PR 2 — «ШАГ 15 … ПОСЛЕ 14_news_moderation.sql»).
- Отметка версии — как `deploy/stamp_alembic_0013.sql`: две строки комментария + `UPDATE trendsetter_hub.alembic_version SET version_num = 'NNNN' WHERE version_num = '<предыдущая>';`.
- **Если к моменту старта (или перед пушем, когда его разрешат) в `main` появились новые ревизии** — взять следующие свободные номера: проверить `ls backend/alembic/versions` и `git fetch && git ls-tree --name-only origin/main backend/alembic/versions/`; перенумеровать согласованно **всё**: имена файлов ревизий, `revision`/`down_revision`, `db/NN_*.sql` (NN = новый номер ревизии) и `SQL_FILES`, шапки «ШАГ NN», `deploy/stamp_alembic_NNNN.sql`, ожидаемую версию в `test_database.py`, разделы `db/README.md`, этот файл. Одна голова, без merge-ревизий.

## Разбиение на два PR
- **PR 1 — предложка + модерация + «Мои предложения» в профиле + пункт меню «Редактор новостей»** (ревизия `0014`). Самодостаточен: после него весь поток «предложил → проверили → опубликовано / доработка / отклонено» работает, вкладка «Новости» в профиле заменена разделом в меню.
- **PR 2 — ручной порядок закреплённых + виджеты главной** (ревизия `0015`). Зависит от PR 1 (раздел «Редактор новостей» и ревизия `0014`). Закрепление (`pinned`) уже есть — добавляется только порядок.

## Что уже есть в `main` (сверено 2026-10-29, не делать заново)
- `news_items.created_by` — это и есть **автор**; `author_id` не вводится. Признак «запись — предложение» = `submitted_at IS NOT NULL`.
- `news_items.status` — `CHECK (status IN ('draft','published'))` inline в `db/09_news.sql` (без явного имени). `news_items.archived` — булев.
- `news_items.color` (ревизия `0010`, `news_items_color_check`, ключи `red|green|yellow|blue|pink|gray`, `NULL` = нейтральный) — уже в `ItemBody`/`ItemPatchBody`, `NewsEditorDrawer` (`ColorPicker`), `lib/news.js` (`NEWS_COLORS`, `colorClass`), mock. Предложение автора **тоже несёт `color`** (поле формы общее).
- `news_items.pinned` — колонка, «Закрепить» в `NewsEditorDrawer`, сортировка `pinned DESC` в `feed` и `TABS['current']`. Новой колонки `pinned` не будет.
- Бэкенд `backend/app/modules/news/`: `service.py` (`_now`, `fail`, `access_of`, `can_read`, `is_editor`, `_items`, `TABS = {current, past, drafts}`, `_validate_state`, `create_item`, `update_item` с `SELECT … FOR UPDATE`, `delete_item`, `MSG_*`, `log_action`); `router.py` (зависимости `Reader` — читатель **или** редактор, `Editor`; модели `ItemBody`, `ItemPatchBody` с `extra='forbid'`; удаление — `POST /items/{id}/delete`). Ответ записи уже содержит `updatedAt` (`_iso(updated_at)`).
- Права «Ответственный»: `is_editor` = responsible на `news` (в т. ч. через группу) **или** `can_manage_users` (admin); фронт — `isNewsEditor(me)` (`me.module_responsible.news === true || me.can_manage_users === true`); `canReadNews(me)` = `canSeeData(me.module_access.news)` (view/run; viewer — `structure`, не читатель). `TODO(Q-N3)` (superuser без явного права не редактор) сохраняется.
- `core/registry.py`: `ModuleManifest(..., badge=, daily_job=)`; у `news` — `for_all=True`, `badge` нет. `badge(session, user) -> int` → `me.module_badges[id]` (образец `hr_service.badge`). Ядро бэкенда для бейджа не меняется.
- `modules/registry.js`: `news` — `{ hidden: true, forAll: true, Component: null }`, последняя строка `MODULES`; `hidden: true` также у `pricing` (булев флаг должен продолжать работать). `PROFILE_SECTIONS` содержит `id: 'news'` (редактору). `HOME_WIDGETS`: `birthdays`, `leave` (без `slot` — правая колонка), `news-banner` (`'banner'`), `news-feed` (`'left'`), `news-events` (`'center'`).
- Главная (PR #27 + дизайн PR #39): `HubPage.jsx` — баннер, приветствие, сетка `home-layout with-feed` из **трёх колонок**: «Новости» (`HomeNewsFeed`), «Ближайшие события» (`HomeEvents`), правая `home-aside` — `ClocksCard`, `WeatherCard`, `RatesCard`, затем `HOME_WIDGETS` без `slot`. Нет доступа к новостям → колонок нет, виджеты во всю ширину. Шапка колонки новостей — `div.news-col-title`.
- Меню (`AppLayout.jsx`): `MODULES.filter((m) => !m.hidden)`, пункт рисует `m.strings.tool` и `m.strings.dept` («Компания» у news), бейдж — `me.module_badges[m.id]`. `ModulePage.jsx`: `if (!module || module.hidden) return <NotFoundPage />` — первой строкой, до проверки доступа.
- `ProfilePage.jsx`: неизвестный/скрытый `?section=` → первая видимая вкладка (`visible.find(...) ?? visible[0]`) — старая ссылка `/profile?section=news` безопасна без правок ядра.
- `NewsItemModal.jsx`: «Управлять» → `/profile?section=news` (меняется в PR 1).
- Срочная плашка (`news_banners`, `BannerEditor`) и вкладки «Актуальное / Прошедшие и архив / Черновики» (`NewsAdminSection`) — переносятся в раздел как есть, добавляется вкладка «На проверке».
- Уведомления: `app.core.notifications.notify(session, user_ids, kind, title, body="", link=None)` (коммитит вызывающий), образец — HR. Mock: `notifications.notify(userIds, { kind, title, body, link })`.
- `useAuth()` отдаёт `refreshMe`.
- Mock: `createNewsHandlers({ userFromToken, accessTo, isEditor, errors, now })`; в `handlers.js` `moduleBadges(user)` суммирует `team` и `hr`; `findUser(id)` бросает 404 (для автора не подходит — см. Mock). Демо: id 3 «Ани С.» (employee), id 9 «Сотрудник HR» (демо-редактор новостей), id 10 «Кравцов Денис».

## Решения (пользователь 2026-10-27; по умолчанию — помечено)
1. **Статусы** `news_items.status`: `draft | pending | needs_changes | published | rejected`. `archived` **остаётся булевым** (на нём держатся условия вкладок). Переходы:
   - автор: (нет) → `pending` (подать); `pending` → `pending` (правка до проверки); `needs_changes` → `pending` (доработал и отправил снова); `rejected` → `pending` (доработал отклонённое и подал повторно, Q-NM5);
   - редактор: `pending` → `published` (approve), `pending` → `needs_changes` (return, с комментарием), `pending` → `rejected` (reject, с причиной);
   - `rejected` **не финальный** (Q-NM5); у модератора на каждой проверке три исхода;
   - прежние переходы редактора `draft ↔ published` и архив — только для записей в `draft`/`published`.
2. **Право подать предложение** = зависимость `Reader` (читатель `can_read` **или** редактор). viewer (`structure`) → 403, кнопки нет. Редактор тоже может подать — попадёт в общую очередь (Q-NM11).
3. **Обход модерации запрещён:** `PATCH /items/{id}` редактора на записи в `pending` меняет только содержимое (в теле есть `status` или `archived` → 409); на `needs_changes` / `rejected` → 409 целиком. Опубликовать/вернуть/отклонить предложение — только эндпойнтами проверки.
4. **Защита от гонки:** эндпойнты проверки принимают `expectedUpdatedAt`; не совпал с `updated_at` → 409 «Запись изменилась, обновите список». **Фронт передаёт строку `updatedAt` из последнего ответа сервера дословно** (без `new Date(...)`/`toISOString()` — они обрезают микросекунды до миллисекунд, и каждое approve падало бы в 409); бэкенд сравнивает моменты времени (`AwareDatetime` == `timestamptz`).
5. **«Поправить и опубликовать»** — одна кнопка, два запроса: `PATCH /items/{id}` (если форма менялась) → `POST /items/{id}/approve` с `expectedUpdatedAt` = `updatedAt` **из ответа PATCH**. Сбой второго оставляет запись в `pending` с правками — безопасно.
6. **Антиспам:** на автора не больше **3 открытых** (`pending` + `needs_changes`) и не больше **5 новых предложений за 24 часа** (по `created_at`, `submitted_at IS NOT NULL`); превышение → **429** с русским текстом (Q-NM2). Лимит открытых проверяется при создании и при повторной подаче отклонённого (`rejected` → `pending` увеличивает число открытых; `needs_changes` → `pending` — нет); суточный — только при создании. Константы `PROPOSAL_OPEN_LIMIT = 3`, `PROPOSAL_DAILY_LIMIT = 5` в `service.py`. Гонку двух одновременных подач одного автора не закрываем (превышение на 1 допустимо, Q-NM16).
7. **Уведомления — только автору** при approve / return / reject (`kind='news_review'`, ссылка `/profile?section=proposals`); автор удалён (`created_by IS NULL`), неактивен или это сам проверяющий — не шлём. Редакторам о новом предложении — только бейдж (Q-NM3). Заголовок записи и комментарий модератора в тексте уведомления — можно (как у HR «Причина: …»).
8. **Журнал:** `news.submit` (news_id, kind), `news.resubmit` (news_id, fields), `news.approve` / `news.return` / `news.reject` (news_id). **Ни заголовков, ни текстов, ни комментариев модератора** в `details`. PR 2: `news.reorder` (kind, count), `home.widgets_update` (module_id `NULL`; details: `count`, `disabled` — список id).
9. **Раздел «Редактор новостей» в меню.** Флаг реестра `hidden` — «`boolean` или функция `(me) => boolean`»; у `news` — `hidden: (me) => !isNewsEditor(me)` и `Component` = страница редактора. Ядро вызывает предикат из реестра и про `news` не знает. `ModulePage` проверяет `hidden` **до** проверки доступа. Не-редактору пункта нет, `/modules/news` → «Не найдено». Пункт стоит последним в списке «Отделы» с подписью «Компания» (`strings.dept`) — **по умолчанию** (Q-NM15), отдельной группы меню нет.
10. **Вкладка «Новости» в профиле убирается**, её содержимое — в раздел `/modules/news`. «Управлять» в `NewsItemModal` → `/modules/news`. `/profile?section=news` открывает первую вкладку профиля (`ProfilePage` уже так работает, не меняется).
11. **Подпись пункта меню:** `newsStrings.tool = 'Редактор новостей'` (она же — подпись в «Особых правах», Q-NM7). `name`/`title` остаются «Новости».
12. **Где автор видит статус:** вкладка профиля «Мои предложения» (`id: 'proposals'`), бейдж = число `needs_changes` + `rejected`. На главной в шапке колонки «Новости» (`HomeNewsFeed`) — кнопка «Предложить новость» и ссылка «Мои предложения».
13. **Форма предложения — модальное окно по центру** (Q-NM1), у модератора — боковая панель. Поля — **общий компонент** `components/NewsForm.jsx` (вынести из `NewsEditorDrawer` `Field`, `ColorPicker`, `initialOf`, `validate`, `payloadOf`; проп `withPinned`), его используют `NewsEditorDrawer` (режимы `edit`, `review`) и `ProposalModal.jsx`. Копий полей и проверки нет.
14. **(PR 2) Ручной порядок — только среди закреплённых**, отдельно для событий и новостей: колонка `sort`, стрелки вверх/вниз (без drag) — Q-NM9.
15. **(PR 2) Виджеты главной — настройка ядра**: таблица `home_widgets` (без приставки), эндпойнты в `routes_core.py`. Право записи — admin **или** «Ответственный» модуля с `home_editor=True` в манифесте (у `news`), Q-NM8. Настраивается только правая колонка; плашка и колонки новостей/событий — нет (Q-NM12). Одна настройка на всех; поверх неё у каждого действует `visible(me)`.

---

# PR 1 — предложка и модерация

## Данные (`db/14_news_moderation.sql`, ревизия `0014`, `deploy/stamp_alembic_0014.sql`)
Идемпотентно, схема `trendsetter_hub`, шапка — см. «Правила нумерации». Права hub_app уже выданы на таблицу. Существующие `.sql` не трогать.
```sql
ALTER TABLE trendsetter_hub.news_items ADD COLUMN IF NOT EXISTS submitted_at   timestamptz;
ALTER TABLE trendsetter_hub.news_items ADD COLUMN IF NOT EXISTS review_comment text;
ALTER TABLE trendsetter_hub.news_items ADD COLUMN IF NOT EXISTS reviewed_by    bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL;
ALTER TABLE trendsetter_hub.news_items ADD COLUMN IF NOT EXISTS reviewed_at    timestamptz;
-- DO-блок (образец — 10_news_color.sql):
--  1) найти в pg_constraint CHECK таблицы news_items (contype = 'c'), у которого pg_get_constraintdef(oid) содержит 'status'
--     и 'published', но НЕ содержит 'pending' (старое inline-ограничение из 09_news.sql; имя не хардкодить),
--     и снять его: EXECUTE format('ALTER TABLE trendsetter_hub.news_items DROP CONSTRAINT %I', conname);
--  2) добавить, если ещё нет (проверка по conname):
--     news_items_status_v2_check      CHECK (status IN ('draft','pending','needs_changes','published','rejected'))
--     news_items_review_comment_check CHECK (review_comment IS NULL OR char_length(review_comment) BETWEEN 1 AND 1000)
--     news_items_proposal_check       CHECK (status NOT IN ('pending','needs_changes','rejected') OR submitted_at IS NOT NULL)
CREATE INDEX IF NOT EXISTS news_items_author_idx  ON trendsetter_hub.news_items (created_by, created_at) WHERE submitted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS news_items_pending_idx ON trendsetter_hub.news_items (submitted_at) WHERE status = 'pending';
```
- Имена ограничений — ровно как выше. Повторный прогон скрипта ничего не меняет и не падает.
- **Downgrade `0014`** (в `.py`, через `op.execute`): `UPDATE trendsetter_hub.news_items SET status = 'draft' WHERE status IN ('pending','needs_changes','rejected')` → `DROP CONSTRAINT IF EXISTS` трёх новых → `DROP INDEX IF EXISTS` двух → `ADD CONSTRAINT news_items_status_check CHECK (status IN ('draft','published'))` → `DROP COLUMN IF EXISTS` четырёх колонок. Права модуля не трогать.
- `test_database.py`: ожидаемая версия `0014` (сейчас `"0013"`).
- `db/README.md` — раздел «Новости: предложка и модерация (ревизия 0014)» в стиле разделов `0010`/`0011`, вставить после абзаца про ревизию `0013`, перед «Модуль «Склад»»: что добавляет; **выкат**: 1) под doadmin в `defaultdb` выполнить `db/14_news_moderation.sql` (после `modules/wb/002_wb_marking_imported.sql`); 2) `deploy/stamp_alembic_0014.sql` (`0013 → 0014`); 3) только после этого — merge в `main` (иначе `/modules/news/*` → 500: в запросах новые столбцы). **Откат** (`alembic downgrade 0013`): предложения становятся черновиками, комментарии и сведения о проверке теряются.

## Бэкенд (`backend/app/modules/news/`)

### Объект записи
Ответы `/feed`, `rsvp`, `responses` **не меняются**. Для списков редактора (`GET /items`, ответы `approve/return/reject`, `POST`/`PATCH /items`) и собственных записей автора (`/proposals/*`) добавляется ключ:
```json
"review": {
  "author": {"id": 3, "name": "Ани С."},
  "submittedAt": "2026-10-27T09:00:00+00:00",
  "reviewComment": "Добавьте место сбора",
  "reviewedAt": "2026-10-27T10:00:00+00:00"
}
```
`author.name` = `users.full_name`; `author` — `null`, если автор удалён; `reviewComment` / `reviewedAt` — `null`, если нет. `review: null` у записей с `submitted_at IS NULL`. Имя модератора не отдаётся (Q-NM14). Реализация — необязательный флаг у `_items(...)` (имена авторов одним запросом на список), не второй сериализатор.

### Эндпойнты автора (под `/modules/news`; зависимость `Reader`: без токена 401, viewer — 403)
| Метод и путь | Тело | Ответ | Правила |
|---|---|---|---|
| `GET /proposals/mine` | — | `{items: Item[]}` | свои (`created_by = me AND submitted_at IS NOT NULL`), любые статусы и `archived`; `created_at DESC, id DESC`; `LIMIT 50` |
| `POST /proposals` | `ProposalBody` | `Item` | `status='pending'`, `pinned=false`, `created_by=updated_by=me`, `submitted_at=created_at=updated_at=now`, `published_at=NULL`; `_validate_state`; лимиты (решение 6) → 429; журнал `news.submit` |
| `PATCH /proposals/{id}` | `ProposalPatchBody` | `Item` | `SELECT … FOR UPDATE`; нет записи / чужая / `submitted_at IS NULL` → **404**; `published` → 409 «Предложение уже опубликовано»; итог всегда `pending`; из `needs_changes`/`rejected` — `submitted_at=now` (в конец очереди), из `rejected` — ещё и проверка лимита открытых (429); из `pending` — `submitted_at` прежний; `review_comment` сохраняется; из `needs_changes`/`rejected` без изменений полей — всё равно переотправка; из `pending` без изменений — вернуть запись без записи в БД и журнал; журнал `news.resubmit` (fields — имена изменённых полей, может быть пустым) |

`ProposalBody` = поля `ItemBody` **без** `pinned` и `status` (`kind`, `title`, `body`, `place`, `startsAt`, `endsAt`, `color`, `rsvpEnabled`, `rsvpDeadline`, `rsvpNamesPublic`), `model_config = ConfigDict(extra='forbid')` (`pinned`/`status` → 422). `ProposalPatchBody` = поля `ItemPatchBody` без `pinned`, `status`, `archived`, `extra='forbid'`; `kind` не меняется. Поведение и ответы существующих `ItemBody`/`ItemPatchBody` не меняются (общий базовый класс — допустимо, если их поведение то же).

### Эндпойнты редактора (`Editor`: не-редактору 403)
| Метод и путь | Тело | Ответ | Правила |
|---|---|---|---|
| `GET /items?tab=review` | — | `{items, total}` | новое значение `tab` (расширить `Literal` в `router.py`): `status IN ('pending','needs_changes')`; сортировка `(status = 'pending') DESC, submitted_at ASC, id ASC`; пагинация как у других вкладок |
| `POST /items/{id}/approve` | `{expectedUpdatedAt}` | `Item` | `FOR UPDATE`; нет → 404; не `pending` → 409 «Предложение уже рассмотрено»; `updated_at ≠ expectedUpdatedAt` → 409 «Запись изменилась, обновите список»; `status='published'`, `published_at = coalesce(published_at, now)`, `reviewed_by/reviewed_at/updated_by/updated_at`; уведомление «Ваша новость опубликована» (body — заголовок); журнал `news.approve` |
| `POST /items/{id}/return` | `{comment, expectedUpdatedAt}` | `Item` | те же 404/409; `status='needs_changes'`, `review_comment=comment`; уведомление «Новость нужно доработать», body: `«{title}»: {comment}`; журнал `news.return` |
| `POST /items/{id}/reject` | `{comment, expectedUpdatedAt}` | `Item` | те же 404/409; `status='rejected'`, `review_comment=comment`; уведомление «Новость отклонена», body: `«{title}». Причина: {comment}. Можно доработать и отправить снова.`; журнал `news.reject` |

`comment`: strip, 1..1000 символов (пусто → 422). `expectedUpdatedAt`: `AwareDatetime`, сравнение моментов времени. Approve прошедшего события — публикуется как есть (Q-NM13).

### Изменения существующего
- `TABS`: добавить `review`; `drafts` — по-прежнему `status='draft'`; `past` — `(status='published' AND {PAST}) OR status='rejected'`, сортировка `coalesce(starts_at, published_at, reviewed_at) DESC, id DESC`; `current` — без изменений (там только `published`).
- `update_item` (PATCH редактора): текущий статус `needs_changes` или `rejected` → 409 «Запись у автора на доработке»; `pending` и в `data` есть `status` или `archived` → 409 «Используйте кнопки проверки». Иначе без изменений (содержимое `pending`, включая `pinned` и `color`, править можно).
- `create_item`, `delete_item`, `feed`, `set_rsvp`, `responses`, плашка — без изменений (редактор может удалить и предложение; автору не сообщаем — Q-NM4).
- `badge(session, user) -> int`: 0, если не `is_editor`; иначе `count(*) WHERE status='pending'`. `core/registry.py`: импорт `from app.modules.news import service as news_service` и `ModuleManifest("news", "Новости", "mvp", news_router, for_all=True, badge=news_service.badge)`.
- Шапка `service.py`: описать статусы и предложку; `TODO(Q-N11)` заменить ссылкой на решение 7 этого ТЗ.
- Новые тексты ошибок — константы `MSG_*` в `service.py` (например `MSG_ALREADY_PUBLISHED`, `MSG_ALREADY_REVIEWED`, `MSG_STALE`, `MSG_AT_AUTHOR`, `MSG_USE_REVIEW`, `MSG_OPEN_LIMIT` «Не больше 3 предложений на проверке одновременно — дождитесь решения редактора», `MSG_DAILY_LIMIT` «Не больше 5 предложений в сутки — попробуйте завтра»; точные формулировки — на усмотрение исполнителя, по-русски).

## Фронтенд

### Ядро (минимальные правки)
- `frontend/src/core/access.js`: чистая `isModuleHidden(module, me)` = `typeof module.hidden === 'function' ? Boolean(module.hidden(me)) : Boolean(module.hidden)` + тест в `access.test.js` (boolean true/false, функция true/false, нет флага).
- `layout/AppLayout.jsx`: фильтр меню `!isModuleHidden(m, me)` вместо `!m.hidden`; комментарий над ним обновить.
- `pages/ModulePage.jsx`: `if (!module || isModuleHidden(module, me)) return <NotFoundPage />` (остаётся первой проверкой).
- Больше в `core/**` ничего (кроме mock).

### Реестр (`frontend/src/modules/registry.js`)
- `news`: `{ id: 'news', status: 'mvp', hidden: (me) => !isNewsEditor(me), forAll: true, wide: true, strings: newsStrings, Component: lazy(() => import('./news/NewsAdminSection.jsx')) }`; обновить комментарий о `hidden` (boolean или `(me) => boolean`). Строка остаётся последней; `TODO(Q-N4)` сохраняется.
- `PROFILE_SECTIONS`: **удалить** `news`; **добавить** в конец `proposals`: `label: newsStrings.proposals.title`, `load: ownData((api) => api.get('/modules/news/proposals/mine'))`, `visible: (me, data) => canReadNews(me) && data != null`, `badge: (data) => data.items.filter((i) => ['needs_changes', 'rejected'].includes(i.status)).length`, `Component: lazy(() => import('./news/MyProposalsSection.jsx'))`.
- `HOME_WIDGETS` в PR 1 не меняется.

### Раздел «Редактор новостей» (`modules/news/NewsAdminSection.jsx` — страница `/modules/news`)
- Получает `{ module, access }` от `ModulePage`. Сверху `h1` «Редактор новостей» (`admin.pageTitle`), затем «Срочная плашка» (`BannerEditor`), затем список.
- `Segmented`: **«На проверке»** (`review`, первая и по умолчанию; в подписи счётчик `me.module_badges.news`, если > 0), «Актуальное», «Прошедшие и архив», «Черновики».
- `ItemRow`: статусы `pending` «На проверке», `needs_changes` «На доработке у автора», `rejected` «Отклонено» + прежние; у предложений — «Автор: имя · отправлено дата» (автор `null` → «Автор удалён») и, если есть, «Комментарий: …». «Опубликовать/Снять» и «В архив» — **только** у `draft`/`published`. У `pending` — «Проверить» (`NewsEditorDrawer` в режиме `review`) и «Удалить»; у `needs_changes`/`rejected` — только «Удалить». Цвет записи отображается как сейчас.
- После approve/return/reject и удаления `pending` — перечитать список и вызвать `refreshMe()` из `useAuth()` (бейдж меню).
- Режим `review`: поля как в `edit` (с «Закрепить» и цветом), сверху автор и прежний комментарий; футер: «Опубликовать» (PATCH, если форма изменена, затем `approve`), «Вернуть на доработку» и «Отклонить» (каждая — `Modal` с обязательным `Input.TextArea`, `maxLength` 1000), «Отмена». В режиме `review` PATCH содержит **только** поля содержимого (`payloadOf`), никогда `status`/`archived` — нынешний `save(publish)` с `status: 'published'` здесь не использовать (иначе 409 «Используйте кнопки проверки»). 409 — `message.error(e.message)`, закрыть Drawer, перечитать список.
- Ссылка «Управлять» в `NewsItemModal` → `/modules/news`.

### Главная (`modules/news/components/HomeNewsFeed.jsx`)
- Шапка колонки «Новости» (`news-col-title`) → строка: заголовок слева; справа ссылка «Мои предложения» (`/profile?section=proposals`) и кнопка «Предложить новость» (`size="small"`). Стили — в `news.css`; в узкой колонке элементы переносятся, без горизонтальной прокрутки. Виджет и так виден только читателю. `HubPage.jsx` в PR 1 не трогать.
- Кнопка открывает `ProposalModal` (`item = null`); успех → `message.success` «Отправлено на проверку», модалка закрывается.

### Форма: `components/NewsForm.jsx`, `components/ProposalModal.jsx`, `components/NewsEditorDrawer.jsx`
- `NewsForm` — управляемый компонент (`value`, `onChange`, `withPinned`, `isNew` — выбор типа только при создании) с полями из текущего Drawer, включая `ColorPicker`. Функции `initialOf`, `validate`, `payloadOf` — экспорт из `NewsForm.jsx` **или** перенос в `lib/news.js` с тестами (на выбор исполнителя, без дублирования); при `withPinned=false` `payloadOf` не включает `pinned`. `NewsEditorDrawer` в режиме `edit` после выноса ведёт себя как раньше.
- `ProposalModal` (`Modal centered`, `width={560}`): тип (только при создании), заголовок, поля события, описание, цвет, голосование, срок ответа, «Показывать всем, кто идёт» (подсказка автору: «Выключено — имена видит только редактор»); **без** «Закрепить». Футер: «Отправить на проверку» (`POST /proposals`; для существующей записи — «Отправить снова», `PATCH /proposals/{id}`), «Отмена». 422/429/409 — `message.error(e.message)`, модалка остаётся открытой.

### «Мои предложения» (`modules/news/MyProposalsSection.jsx`)
- Получает `{ me, data, reload }`. Список `data.items`: тег типа, тег статуса (На проверке / Нужна доработка / Опубликовано / Отклонено; опубликованное в архиве — «В архиве»), заголовок, дата отправки; у `needs_changes`/`rejected` — «Комментарий редактора: …».
- `pending` — «Изменить», `needs_changes` и `rejected` — «Доработать и отправить снова» → `ProposalModal` с записью → `reload()`.
- Пусто — «Вы ещё ничего не предлагали» и кнопка «Предложить новость» (`ProposalModal`, затем `reload()`).

### Строки (`modules/news/strings.js`)
`tool` = «Редактор новостей»; `permissionHint` = «„Ответственный“ — редактор новостей: проверка предложений, публикация, срочная плашка (раздел „Редактор новостей“ в меню)»; блок `profile` удалить; новый блок `proposals` (`title` «Мои предложения», `empty`, `propose` «Предложить новость», `status.*`, `comment`, `edit`, `resubmit`, `sent` «Отправлено на проверку»); `home.propose`, `home.myProposals`; `admin.pageTitle`, `admin.tabs.review`, `admin.status.pending/needs_changes/rejected`, `admin.actions.review`, `admin.empty.review`, `admin.author`, `admin.authorDeleted`, `admin.comment`; в `editor` — `submit`, `resubmit`, `approve`, `return`, `reject`, `commentLabel`, `commentRequired`, `fieldNamesPublicHintAuthor`; `errors.*` для новых `MSG_*` (mock). В JSX — без литералов.

### Mock (`VITE_DEMO_MODE`)
- `core/api/mock/news.js`: фабрика получает дополнительно `notify` (как `hrOps`) и `userById(id) -> user | null` (не бросает); возвращает ещё `moduleBadges(user)` (`{ news: n }` редактору при n > 0, иначе `{}`). Все новые эндпойнты с тем же контрактом и кодами (401/403, 404 чужого, 409 гонки и обхода, 429 с лимитами 3/5, сравнение `expectedUpdatedAt` по моменту времени, ключ `review` в ответах). Журнал не ведётся.
- Демо-данные: `pending` (автор 3 «Ани С.»), `needs_changes` (автор 3, с комментарием), `rejected` (автор 10, с причиной), опубликованное предложение (автор 3). Тексты вымышленные.
- `mock/handlers.js`: передать `notify: notifications.notify` и `userById: (id) => data.users.find((u) => u.id === Number(id)) ?? null`; в `moduleBadges(user)` добавить слагаемое `news.moduleBadges(user)` тем же циклом суммирования, что у `hr`.

## Тесты PR 1
**Бэкенд (`backend/tests/test_news.py`; фикстура `clock` уже подменяет `service._now`):**
1. Права: viewer — 403 на `/proposals*`; employee — 200 на свои `/proposals*`, 403 на `tab=review` и `approve/return/reject`; редактор и admin — 200; без токена — 401.
2. Предложение создаётся `pending` с `submittedAt`, `pinned=false`, с `color`; `pinned`/`status` в теле → 422; валидация события → 422 как у редактора.
3. До approve нет в `/feed` и `current/past/drafts`; после — в `/feed`, `publishedAt` выставлен.
4. Автор: чужое предложение и запись редактора → 404; PATCH `pending` → `pending`, `submittedAt` прежний; PATCH `needs_changes` и `rejected` → `pending`, `submittedAt` новый, запись в `tab=review`; повторная подача отклонённого сверх 3 открытых → 429; PATCH `published` → 409; `/proposals/mine` — только свои.
5. Проверка: только из `pending` (иначе 409); устаревший `expectedUpdatedAt` → 409; **`updated_at` с ненулевыми микросекундами и `expectedUpdatedAt` = `updatedAt` из ответа → 200**; return/reject без комментария и с 1001 символом → 422; после return автор видит `reviewComment`; `rejected` виден во вкладке `past`.
6. Обход: PATCH редактора `{status:"published"}` и `{archived:true}` у `pending` → 409; PATCH содержимого `pending` → 200, статус `pending`; любой PATCH `needs_changes`/`rejected` → 409.
7. Уведомления: по одному автору на решение, `kind="news_review"`, ссылка `/profile?section=proposals`; редактор, проверяющий своё, и неактивный автор — без уведомления.
8. Антиспам: 4-е открытое → 429, после approve одного — снова можно; 6-е за 24 ч → 429; через 24 ч (`clock`) — снова можно.
9. `/core/me` → `module_badges.news` = число `pending` у редактора; у employee — нет/0.
10. Журнал: `news.submit/resubmit/approve/return/reject`, `module_id="news"`; в `json.dumps(details)` нет заголовка, текста и комментария.

**`backend/tests/test_database.py`:** версия `0014`; повторный прогон `db/14_news_moderation.sql` без ошибок; **`news_items_status_v2_check` существует, и среди CHECK таблицы нет ни одного, чьё определение содержит `'published'` и не содержит `'pending'`** (закрывает T-NM1); downgrade до `0013` при наличии `pending`-строки проходит (строка становится `draft`), затем upgrade обратно.

**Фронтенд (`node --test`):** `access.test.js` — `isModuleHidden`; `mock/news.test.js` — права и коды новых эндпойнтов, повторная подача отклонённого (→ `pending`, лимит открытых), 404 чужого, 409 гонки и обхода, 429, уведомление через переданный `notify`, бейдж только редактору, `review.author` через `userById`, «правка содержимого `pending` (PATCH) → approve с `updatedAt` из ответа PATCH» → 200; `lib/news.test.js` — если функции формы переехали в `lib`.

## Файлы PR 1
**Создаются:** `db/14_news_moderation.sql`, `backend/alembic/versions/0014_news_moderation.py`, `deploy/stamp_alembic_0014.sql`, `frontend/src/modules/news/MyProposalsSection.jsx`, `frontend/src/modules/news/components/NewsForm.jsx`, `frontend/src/modules/news/components/ProposalModal.jsx`.
**Меняются:** `backend/app/modules/news/service.py`, `router.py`; `backend/app/core/registry.py` (только импорт и `badge=` у `news`); `backend/tests/test_news.py`, `test_database.py`; `frontend/src/core/access.js`, `access.test.js`, `layout/AppLayout.jsx`, `pages/ModulePage.jsx`; `frontend/src/core/api/mock/news.js`, `news.test.js`, `handlers.js`; `frontend/src/modules/registry.js`; `frontend/src/modules/news/strings.js`, `news.css`, `NewsAdminSection.jsx`, `components/NewsEditorDrawer.jsx`, `components/HomeNewsFeed.jsx`, `components/NewsItemModal.jsx`, при выносе функций — `lib/news.js`, `lib/news.test.js`; `db/README.md`; этот файл (только раздел «Отступления реализации»).

---

# PR 2 — порядок закреплённых и виджеты главной

## Данные (`db/15_home_widgets.sql`, ревизия `0015`, `deploy/stamp_alembic_0015.sql`)
```sql
ALTER TABLE trendsetter_hub.news_items ADD COLUMN IF NOT EXISTS sort integer;  -- порядок среди закреплённых; NULL у незакреплённых

CREATE TABLE IF NOT EXISTS trendsetter_hub.home_widgets (
  widget_id  text PRIMARY KEY CHECK (widget_id ~ '^[a-z0-9-]{1,40}$'),
  position   integer NOT NULL CHECK (position >= 0),
  enabled    boolean NOT NULL DEFAULT true,
  updated_by bigint REFERENCES trendsetter_hub.users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```
- Пустая таблица = порядок по умолчанию, всё включено (сидов нет).
- Права hub_app — автоматически через `ALTER DEFAULT PRIVILEGES` из `01_core_hub.sql` (тот же механизм покрыл `news_*` и `wb_*`); тест — по образцу проверки прав на таблицы новостей в `test_database.py`.
- Downgrade: `DROP TABLE IF EXISTS home_widgets`, `DROP COLUMN IF EXISTS sort`. `test_database.py` — версия `0015`. `db/README.md` — раздел «Виджеты главной и порядок закреплённых (ревизия 0015)», выкат `0014 → 0015` по той же схеме.

## Бэкенд
**Порядок закреплённых (модуль news):**
- `POST /modules/news/pinned-order` (редактор), тело `{kind: "news" | "event", ids: int[]}`. `ids` должен **точно** совпадать с множеством текущих закреплённых записей этого типа (`status='published' AND pinned` + `CURRENT_EVENT`/`CURRENT_NEWS`), иначе 409 «Список изменился, обновите». Ставит `sort = индекс`. Журнал `news.reorder` (kind, count).
- `update_item`: при смене `pinned` (в любую сторону) — `sort = NULL`.
- Сортировка `feed` и `TABS['current']`: `pinned DESC`, (во вкладке `current` — `(kind='news') ASC`), затем `CASE WHEN pinned THEN sort END ASC NULLS LAST`, затем прежние ключи.

**Виджеты (ядро):**
- `ModuleManifest` получает поле `home_editor: bool = False` (комментарий: «Ответственный этого модуля может настраивать виджеты главной»); у `news` — `True`.
- `core/routes_core.py`:
  - `GET /core/home/widgets` — любой вошедший (включая viewer): `{widgets: [{id, enabled}]}` по `position`.
  - `POST /core/home/widgets` — тело `{widgets: [{id, enabled}]}`, 1..30 элементов, id по шаблону, без повторов (иначе 422). Право: `can_manage_users` **или** `responsible` хотя бы на одном модуле с `home_editor=True` (через `module_rights`), иначе 403. Замена всех строк в одной транзакции (`DELETE` + `INSERT`, `position` = индекс), журнал `home.widgets_update`. Ответ — как у `GET`.
  - Сервер **не** знает каталог виджетов: неизвестные id хранятся, фронт их игнорирует. SQL — через `text()`, ORM-модель не добавлять.

## Фронтенд
- `HOME_WIDGETS` (реестр): у записей без `slot` добавить `label`: `birthdays` → `teamStrings.birthdays.title`, `leave` → новый ключ `teamStrings.home.widgetLabel` = «Отпуска»; описать поле в комментарии.
- Новый `frontend/src/core/home/widgetConfig.js` (без React): `applyWidgetConfig(widgets, config)` — `config == null` → как есть; иначе сначала по порядку `config` (неизвестные id пропускаются), затем не упомянутые в порядке по умолчанию; `enabled: false` убираются. Плюс `widgetConfig.test.js`.
- Новый `frontend/src/core/home/asideWidgets.js`: `ASIDE_WIDGETS` = встроенные `clocks`, `weather`, `rates` (подписи `strings.hub.home.clocksTitle / weatherTitle / ratesHeading`, `visible` — всегда) + `HOME_WIDGETS` без `slot`.
- `HubPage.jsx`: правая колонка (`home-aside`) = `applyWidgetConfig(ASIDE_WIDGETS, config)`, затем фильтр `visible(me)`. `GET /core/home/widgets` один раз при монтировании; пока грузится — `Spin size="small"` в колонке; ошибка → порядок по умолчанию. Слоты `banner/left/center` и трёхколоночная сетка не меняются.
- Раздел «Редактор новостей»: секция «Виджеты главной» (`modules/news/components/HomeWidgetsEditor.jsx`): список `ASIDE_WIDGETS` в текущем порядке (выключенные тоже видны) — подпись, `Switch` «Показывать», стрелки вверх/вниз (`aria-label`), «Сохранить» → `POST /core/home/widgets`. Модуль импортирует `core/home/asideWidgets.js` (модуль → ядро разрешено).
- Вкладка «Актуальное»: у закреплённых строк стрелки вверх/вниз внутри своего типа → `POST /modules/news/pinned-order`; 409 → сообщение и перечитать.
- Строки: новые строки ядра — в `core/strings.js`; остальное — в `modules/news/strings.js`.
- Mock: `mock/home.js` — оба эндпойнта виджетов (право: `canManageUsers(u)` или `responsible` на модуле с фронтовым флагом `homeEditor: true`; флаг добавить у `news` в `MODULES`, предикат передать из `handlers.js`); `mock/news.js` — `pinned-order` и сортировка по `sort`.

## Тесты PR 2
- Бэкенд: `pinned-order` — 403 employee, 409 при несовпадении множества, порядок в `/feed` и `current` по `sort`, смена `pinned` обнуляет `sort`; журнал без текстов. Виджеты (в `test_home.py`) — `GET` всем (включая viewer); `POST` — 403 employee и superuser без права, 200 admin и responsible на `news`; 422 на дубли / шаблон / 31 элемент; замена целиком; запись `home.widgets_update`. `test_database.py` — версия `0015`, права hub_app на `home_widgets`.
- Фронт: `widgetConfig.test.js` (пустой config, порядок, неизвестные id, новые виджеты в конце, выключенные); `mock/home.test.js`, `mock/news.test.js` — новые эндпойнты.

## Файлы PR 2
**Создаются:** `db/15_home_widgets.sql`, `backend/alembic/versions/0015_home_widgets.py`, `deploy/stamp_alembic_0015.sql`, `frontend/src/core/home/widgetConfig.js`, `widgetConfig.test.js`, `asideWidgets.js`, `frontend/src/modules/news/components/HomeWidgetsEditor.jsx`.
**Меняются:** `backend/app/core/registry.py` (поле `home_editor`, флаг у `news`), `routes_core.py`; `backend/app/modules/news/service.py`, `router.py`; `backend/tests/test_news.py`, `test_home.py`, `test_database.py`; `frontend/src/core/pages/HubPage.jsx`, `core/api/mock/home.js`, `home.test.js`, `news.js`, `news.test.js`, `handlers.js`; `frontend/src/modules/registry.js`; `frontend/src/modules/team/strings.js` (один ключ); `frontend/src/modules/news/NewsAdminSection.jsx`, `strings.js`, `news.css`; `db/README.md`; этот файл («Отступления реализации»).

---

## Не трогать (оба PR)
Существующие `db/*.sql` и `db/modules/**`, `deploy/stamp_*.sql` и прочие `deploy/*`, ревизии `0001–0013`; `backend/tests/conftest.py`; `core/models.py`; `core/access.py`, `core/deps.py`, `core/notifications.py`, `routes_admin.py`; `/core/me` (ни одного нового поля); модули `hr`, `team`, `warehouse`, `wb` (бэкенд и фронт) — исключение только в PR 2: один ключ `home.widgetLabel` в `frontend/src/modules/team/strings.js`; `ProfilePage.jsx`, `GroupsTab`, `UserPermissionsModal.jsx`, `RoadmapPlaceholder.jsx`; `core/styles.css`, `core/theme.js`, `core/palette.js`; `core/home/ClocksCard|WeatherCard|RatesCard.jsx`; `HubPage.jsx` — только в PR 2; `package.json`, `requirements.txt`, `vite.config.js`; `ARCHITECTURE.md`, `CLAUDE.md`, другие `docs/*` (в т. ч. `docs/TZ-onboarding.md`); репозиторий purchasing_dashboard. Нужен другой файл — остановиться и вернуть вопрос.

## Проверка фактов (закрыто 2026-10-29)
- **T-NM1** (имя inline-CHECK статуса) — имя не хардкодим: DO-блок ищет ограничение по `pg_get_constraintdef`; правильность закрепляет тест `test_database.py` (`news_items_status_v2_check` есть; CHECK с `'published'` без `'pending'` нет).
- **T-NM2** (сравнение `expectedUpdatedAt`) — сервер отдаёт `updated_at` с микросекундами (`_iso` → `isoformat()`), Pydantic `AwareDatetime` и psycopg3 сохраняют микросекунды; риск только на фронте (`Date` обрезает до мс) → решение 4: строка передаётся дословно; тест с ненулевыми микросекундами (тест 5).
- **T-NM3** (права на `home_widgets`) — `ALTER DEFAULT PRIVILEGES` из `01_core_hub.sql` уже покрывает таблицы, созданные doadmin позже (проверено тестом прав на `news_*` в `test_database.py`); для `home_widgets` — такой же тест.

## Закрытые вопросы
Решения пользователя (2026-10-27):
- **Q-NM1** → форма предложения — модальное окно по центру; у модератора — боковая панель; поля — общий `NewsForm`.
- **Q-NM2** → лимиты 3 открытых и 5 новых в сутки на автора, ответ 429.
- **Q-NM5** → «Отклонено» не окончательно: автор может доработать и подать снова.
- **Q-NM7** → пункт меню и подпись в «Особых правах» — «Редактор новостей».
- **Q-NM8** → виджеты главной настраивают администраторы и редакторы новостей (флаг манифеста `home_editor`).
- **Q-NM9** → ручной порядок только среди закреплённых.

По умолчанию (lead, 2026-10-29; implementer стартует без возврата к пользователю, пересмотр — отдельной задачей):
- **Q-NM3** — модераторам только бейдж, без колокольчика.
- **Q-NM4** — автор не отзывает и не удаляет своё предложение; об удалении модератором не сообщаем.
- **Q-NM6** — автор может включить голосование, «Показывать всем, кто идёт» и выбрать цвет.
- **Q-NM10** — без лимита закреплённых.
- **Q-NM11** — предложение редактора идёт в общую очередь (сам себе может одобрить; уведомление себе не шлётся).
- **Q-NM12** — колонки новостей и событий не настраиваются.
- **Q-NM13** — прошедшее на проверке событие публикуется как есть.
- **Q-NM14** — имя модератора автору не показывается.
- **Q-NM15** — пункт «Редактор новостей» — последний в общем списке меню под «Отделы» с подписью «Компания»; отдельной группы меню нет.
- **Q-NM16** — гонка двух одновременных подач одного автора не закрывается (превышение лимита на 1 допустимо).

Новые спорные места при реализации — `TODO(Q-NM17)` и далее + запись в «Отступления реализации».

## Остаются открытыми (не блокируют PR 1)
- Выкат в боевую БД (`db/14_…sql` + stamp до merge) — когда пользователь разрешит пуш и merge.
- `docs/TZ-onboarding.md` устарел по номерам (`0012`, `db/12_onboarding.sql`, «0013 — предложка»): при старте онбординга взять `0016`+ и `db/16_…` (или следующие свободные). В рамках этой задачи не правится.

---

## План
1. PR 1 / БД: `db/14_news_moderation.sql`, ревизия `0014`, stamp `0013 → 0014`, README, `test_database.py` → проверка: `alembic upgrade head` на локальном Postgres из compose, повторный прогон SQL, `alembic downgrade 0013` с `pending`-строкой, снова `upgrade head`.
2. PR 1 / бэкенд: статусы, эндпойнты автора и проверки, запрет обхода через PATCH, `expectedUpdatedAt`, антиспам, уведомления, журнал, `badge` → `pytest backend/tests/test_news.py backend/tests/test_me.py backend/tests/test_database.py`, затем полный `pytest`.
3. PR 1 / фронт-ядро: `isModuleHidden` + тест, `AppLayout`, `ModulePage` → `npm test`; в демо под employee пункта нет, `/modules/news` — «Не найдено»; «Цены» по-прежнему скрыты.
4. PR 1 / mock: новые обработчики, `notify`, `userById`, бейдж, демо-данные → `npm test`.
5. PR 1 / фронт-модуль: реестр, `NewsAdminSection` как страница, вынос `NewsForm`, `ProposalModal`, режим `review`, кнопка на главной, `MyProposalsSection`, строки → `npm run lint`, `npm run build`; демо-сценарии «Ани предлагает → Сотрудник HR возвращает → Ани дорабатывает → публикация» и «отклонено → Ани дорабатывает → снова на проверке» с колокольчиком и бейджем; главная в трёх колонках не ломается (и в узком окне).
6. PR 1 — коммит(ы) в `news-moderation`, без пуша; приёмка ревьюером.
7. PR 2 / БД + бэкенд: `sort`, `home_widgets`, `pinned-order`, виджеты ядра, `home_editor` → `pytest`.
8. PR 2 / фронт: `widgetConfig` + тест, `asideWidgets`, `HubPage`, `HomeWidgetsEditor`, стрелки закреплённых, mock → `npm test`, `npm run lint`, `npm run build`; демо: редактор выключает «Курсы» — пропали у всех; viewer видит тот же порядок.
9. В каждом PR — «Отступления реализации» в этом файле.

## ТЗ для исполнителя
- Ветка `news-moderation`, без пуша, без новых веток и ребейзов. PR 1 целиком → приёмка → PR 2 поверх.
- Индексировать только явными путями из «Файлы PR n» (`git add <путь>`), **никогда** `git add -A` / `git add .` (в рабочей копии лежит неотслеживаемый `docs/TZ-onboarding.md`, его не коммитить).
- Миграции — `0014` (PR 1) и `0015` (PR 2), `down_revision` `0013` и `0014`; SQL — `db/14_…`, `db/15_…`; stamps — `0014`, `0015`. Перед стартом каждого PR проверить `ls backend/alembic/versions` (последняя должна быть `0013` / `0014`); иначе — перенумерация по «Правилам нумерации».
- Менять только файлы из «Файлы PR n». Нужен другой — остановиться и вернуть вопрос.
- Без новых зависимостей (Python/npm), без `dayjs`, без drag-and-drop-библиотек.
- Права — только через `module_rights` / `can_manage_users` / `can_see_data` (бэкенд) и `me.module_access` / `me.module_responsible` / `me.can_manage_users` (фронт). Право автора — зависимость `Reader`; модератора — `Editor`/`is_editor`. Новых таблиц/колонок прав нет.
- Время — только через `_now()` параметром в SQL.
- `expectedUpdatedAt` на фронте — строка `updatedAt` из ответа сервера, без преобразований через `Date`.
- Текст — plain text, без `dangerouslySetInnerHTML`.
- Журнал — только ключи из решения 8; комментарии модератора и заголовки в журнал не писать.
- `frontend/src/core/**` не импортирует `modules/news/**` (связь — через `modules/registry.js`).
- UI-строки — в `modules/news/strings.js` (новые строки ядра — в `core/strings.js`).
- Всё спорное — `TODO(Q-NM17)` и далее + запись в «Отступления реализации».

## Критерии приёмки для ревьюера
**PR 1**
- [ ] Дифф только по «Файлы PR 1»; не тронуты файлы из «Не трогать»; ничего не запушено.
- [ ] Ревизия `0014_news_moderation.py`, `down_revision = "0013"`, `SQL_FILES = ["14_news_moderation.sql"]`; в `versions/` одна голова; `db/14_…sql` и `deploy/stamp_alembic_0014.sql` (`0013 → 0014`) оформлены как образцы `0010`/`0013`. Если в `main` появились новые ревизии — номера согласованно сдвинуты везде.
- [ ] SQL идемпотентен; старый CHECK статуса найден по определению и снят; `news_items_status_v2_check` и два новых CHECK — с явными именами; 4 колонки; downgrade переводит новые статусы в `draft` и проходит при их наличии; README описывает выкат до merge и откат.
- [ ] Автор — `created_by`; признак предложения — `submitted_at IS NOT NULL`; колонок `author_id` и второго `pinned` нет.
- [ ] viewer: нет кнопки «Предложить новость», нет вкладки «Мои предложения», 403 на `/proposals*`, ни одного запроса к `/modules/news/*` на главной.
- [ ] employee: подаёт предложение (`pending`, без `pinned`, с цветом), видит и правит только свои на `pending`/`needs_changes`/`rejected`; чужое — 404; `published` — 409; 403 на `tab=review` и проверку.
- [ ] Предложение не появляется в ленте и вкладках `current/past/drafts` до одобрения; после approve — в ленте с `publishedAt`; `rejected` — во «Прошедшие и архив» с меткой.
- [ ] Обход невозможен: PATCH редактора не меняет `status`/`archived` у `pending` (409) и не трогает `needs_changes`/`rejected` (409); кнопок «Опубликовать/В архив» у таких строк нет.
- [ ] `approve/return/reject` только из `pending`; устаревший `expectedUpdatedAt` → 409; актуальный с микросекундами → 200 (тест есть); фронт не пропускает `updatedAt` через `Date`; «поправить и опубликовать» в режиме `review` проходит (PATCH без `status`/`archived`, затем approve); комментарий обязателен (1..1000).
- [ ] Ровно одно уведомление автору на решение, ссылка `/profile?section=proposals`; себе и неактивному — нет; редакторам колокольчик не шлётся.
- [ ] Антиспам: 4-е открытое и 6-е за сутки → 429 с русским текстом; повторная подача отклонённого учитывается в лимите открытых.
- [ ] Журнал: `news.submit/resubmit/approve/return/reject`, `module_id='news'`; в `details` нет заголовков, текстов и комментариев (есть тест).
- [ ] `/feed`, RSVP и `responses` — без новых ключей; `review` только в списках редактора и `/proposals/*`.
- [ ] Меню: «Редактор новостей» с бейджем числа `pending` — только у admin и responsible на `news`; у employee, superuser без права и viewer пункта нет, `/modules/news` — «Не найдено»; «Цены» (`hidden: true`) по-прежнему скрыты; порядок остальных пунктов прежний; в `core/layout` и `core/pages` нет строки `news`.
- [ ] Вкладки «Новости» в профиле нет; «Управлять» ведёт в `/modules/news`; плашка и три прежние вкладки работают в разделе; бейдж обновляется без перезагрузки (`refreshMe`).
- [ ] Автор — `ProposalModal` по центру, модератор — Drawer; поля и проверка — один общий `NewsForm` (включая `ColorPicker`), копий нет; в модалке нет «Закрепить»; Drawer редактора в режиме `edit` работает как раньше.
- [ ] Главная: кнопка и ссылка в шапке колонки «Новости» не ломают трёхколоночную сетку и узкий экран; `HubPage.jsx` не изменён.
- [ ] «Мои предложения»: статусы, комментарий редактора, «Изменить» / «Доработать и отправить снова» (в т. ч. у отклонённых), бейдж = `needs_changes` + `rejected`.
- [ ] Mock повторяет контракт и права (404/409/429, уведомление через `notify`, автор через `userById`); демо-данные со всеми статусами; сценарии плана (шаг 5) без ошибок в консоли.
- [ ] `npm test`, `npm run lint`, `npm run build`, `pytest` — зелёные; `test_database` ожидает `0014`.

**PR 2**
- [ ] Ревизия `0015`, `down_revision = "0014"`, `db/15_home_widgets.sql`, stamp `0014 → 0015`; `sort` используется только для закреплённых, в `/feed` и во вкладке «Актуальное»; смена `pinned` обнуляет `sort`; `pinned-order` с устаревшим списком → 409.
- [ ] `home_widgets` — таблица ядра без приставки; пустая = порядок по умолчанию; `GET` — всем вошедшим, `POST` — admin и responsible модуля с `home_editor` (в коде ядра нет строки `'news'`), остальным 403.
- [ ] Главная: правая колонка в сохранённом порядке; выключенные не рендерятся и не делают запросов; новые виджеты — в конце; неизвестные id игнорируются; ошибка загрузки → порядок по умолчанию; `visible(me)` действует; плашка и колонки новостей/событий не затронуты.
- [ ] Редактор виджетов: стрелки, переключатели, сохранение одной кнопкой; `applyWidgetConfig` — чистая функция с тестами.
- [ ] Журнал `home.widgets_update` и `news.reorder` без текстов.
- [ ] `npm test`, `npm run lint`, `npm run build`, `pytest` — зелёные; `test_database` ожидает `0015`, права hub_app на `home_widgets` проверены.
- [ ] В конце файла — «Отступления реализации» (или явное «нет») для каждого PR.

## Отступления реализации
**PR 1**
- `update_proposal`: запись автора со статусом `draft` (предложение, которое редактор после публикации снял с публикации; `submitted_at` остаётся) отвечает 409 с текстом «Предложение уже опубликовано» — ТЗ описывает только `published`. TODO(Q-NM17): нужен ли для этого случая отдельный текст/статус.
- Функции формы `initialOf`, `validate`, `payloadOf` вынесены в `modules/news/lib/news.js` (с тестом в `lib/news.test.js`), а не оставлены в `NewsForm.jsx`; `payloadOf(f, withPinned = true)`.
- Approve не очищает `review_comment` (прежний комментарий возврата остаётся у записи); return/reject перезаписывают его.
- В режиме `review` «Вернуть на доработку» и «Отклонить» не отправляют несохранённые правки формы (PATCH делает только «Опубликовать»).
- Демо-данные mock: из-за опубликованного демо-предложения в ленте новостей стало 4 записи вместо 3 — поправлено ожидание в существующем тесте `news.test.js`.
- `test_database.py`: тест отката `alembic downgrade 0013` → `upgrade head` выполняется на общей тестовой базе сессии (в `finally` версия возвращается на `0014`).
