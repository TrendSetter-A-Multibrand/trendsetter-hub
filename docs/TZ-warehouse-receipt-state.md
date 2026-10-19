# ТЗ для WEEEK #18861: Склад, чтение состояния приёмки из БД и удаление кнопки Google.

Ветка `dev-karen`. Код не писал. Изучил файлы:
- `backend/app/modules/warehouse/service.py`, `router.py`;
- `db/modules/warehouse/001_warehouse.sql` (view `warehouse_receipt_summary`);
- `frontend/src/modules/warehouse/store.js`, `lib/{plan,csv,format,print,httpBackend,localBackend}.js`;
- `components/{Header,ScanArea,SidePanel,ClosedTable,PlanPanel}.jsx`, `strings.js`;
- `docs/TZ-warehouse-legacy-import.md`, `docs/CHECKLIST-warehouse-hardware.md`;
- `backend/tests/test_warehouse.py`.

## Что выяснено (факты из кода)

**Где сейчас считаются цифры.** Всё в `S.st = {boxes, scans, closed, alloc, fact, pend, receipt}`. Объект хранится в `whf_state` (localStorage) и создаётся заново (`fresh()`) при смене приёмки.
- Плитки в `ScanArea.jsx`:
  - «отсканировано» = `st.scans.length`;
  - «нет в файле» = `status !== 'ok'`, то есть вместе с излишками;
  - «закрыто» = `st.closed.length`;
  - «ожидается» = `plan.total`.
- `fact[box]` — все сканы коробки за приёмку, при закрытии короба не обнуляются.
- `alloc[n][box]` — только `status === 'ok'`, по нему `route()` решает «в коробку или излишек».
- Ключ `n` зависит от типа скана:

| Тип скана | Ключ `n` |
|---|---|
| обычный | `norm(bc)` |
| «без ЧЗ» | `norm(bc)` |
| ЧЗ при `plan.kiCount > 0` | `ki` |
| ЧЗ при `plan.kiCount = 0` | `norm(ki.slice(2,16))` |

**Поля скана в БД и в браузере различаются.** В `warehouse_scans.barcode` записан `ean || bc`, поэтому у скана ЧЗ там EAN, а КИ лежит в `ki`. В браузере у скана ЧЗ `bc = ki`, `ean = EAN`. На этом строятся выгрузки `allLines`, `kizLines`, `diffCsv`, `byBoxCsv`.

**Закрытие короба.** Цепочка: `assignPallet` (прямой вызов, возвращает итоговый код `S05_K05_P1_0014`), затем операция `close` в очереди. На сервере `sync` в одной транзакции вставляет строку в `warehouse_boxes` и переименовывает сканы со временного кода на итоговый. `reopen_box` удаляет строку из `warehouse_boxes`, сканы остаются с итоговым кодом.

**Что считать открытым коробом в БД:** код в сканах приёмки, для которого нет строки в `warehouse_boxes`. Сюда попадают временные коды, в том числе 482 скана из переноса, и переоткрытые короба. `boxId()` из `format.js` приводит временный и итоговый код к одному виду `05_0014`.

**Как живут открытые короба на ПК.** Локально на одну категорию один открытый короб: `st.boxes[k]`. Импорт и переоткрытие заводят короб как `{base: N, items: []}`, поэтому `undo()` не трогает уже лежащие в нём вещи. `closeBox` с временным кодом работает и для «чужого» временного кода: сервер сам переименует сканы. Значит, 482 скана из переноса технически можно закрыть в хабе. Это расходится с формулировкой Q-M2 в `TZ-warehouse-legacy-import.md`.

**Защиты КИ:**
- сервер: PK `warehouse_marks.ki` и `register_mark`;
- браузер: `markReg` (`whf_marks`) плюс `st.scans.some(s => s.ki === …)`;
- `undo` проходит только по `st.scans` и отправляет `undo{ki}`, после чего сервер удаляет отметку.

**Объём данных.** Только у «Новой Моды»:
- раскладка около 1 млн символов;
- около 7,9 тыс. сканов, вместе с `full_code` это примерно 3 млн символов в формате браузера.

Если писать снимок из БД в `whf_state`, localStorage переполнится, а `save()` при переполнении молча возвращает `false`, и состояние пропадёт после F5. Поэтому снимок держим только в памяти.

**Кнопка Google.** Это только `Header.jsx`, строки 84–86, и строки `header.sheet`, `sheetOffTitle`, `sheetOffSub` в `strings.js`. Красный блок — `showTarget('err msg', …)` по клику, других вызовов нет.

**Тесты фронтенда:** `node --test` (`package.json`), только чистые модули из `lib/`.

## Дизайн (минимальный)

**1. Один новый GET на чтение.** `GET /modules/warehouse/receipt-state?receipt=<имя>&full=false`, право `Run`, как у остальных. DDL, миграций и записей в журнал нет.

**2. Снимок живёт в памяти.** Он кладётся в `S.db`, в localStorage не пишется. Перечитывается:
- при выборе приёмки;
- при `boot`;
- перед каждой выгрузкой.

**3. Пути записи не меняются.** `recordScan`, `undo`, `closeBox`, `czScan`, `sync`, очередь `whf_queue` и `st` остаются как есть. В `st.scans` по-прежнему только сканы этого ПК.

**4. Всё, что показывается и выгружается, строит чистая функция `merge()`** (новый `lib/hydrate.js`). Она возвращает объект той же формы, что `st`, поэтому `csv.js` не меняется. Маршрутизация (`route`, `routeMarked`) берёт `alloc` из этого объекта, то есть по всей приёмке.

**5. Двойного счёта нет за счёт дедупликации по `id` скана и коду короба,** плюс два набора в памяти:
- `S.undone` — id, отменённые после начала запроса снимка, и ссылки `undo` из очереди;
- `S.reopened` — коды, переоткрытые после начала запроса.

**6. Чужие открытые короба** (есть в БД, на этом ПК не открыты) автоматически на ПК не берутся. Показывается диалог с подтверждением, решение — в Q-S1.

## План
1. **Этап 1. Бэкенд, эндпоинт `receipt-state` и тесты.** Проверка: `pytest` зелёный, ответ по количествам совпадает с `warehouse_receipt_summary`.
2. **Этап 2. `lib/hydrate.js` (`fromRow`, `nKey`, `merge`) и `hydrate.test.js`.** Проверка: `npm test` зелёный, все случаи слияния из ТЗ покрыты.
3. **Этап 3. Подключение в `store.js`.** `S.db`, `refreshDb`, `view()`, маршрутизация по `view().alloc`, выгрузки через свежий снимок, диалог чужих коробов. Компоненты переходят на `view()`. Проверка: сценарий Романа на локальной БД с переносом реального файла.
4. **Этап 4. Удалить кнопку и тексты Google.** Проверка: в модуле нет «Google Таблиц», `npm run lint` и `npm run build` чистые.
5. **Этап 5. Отчёт исполнителя:**
   - замеры: размер ответа и время запроса для «Новой Моды»;
   - размер `whf_state` до и после;
   - распределение временных кодов из переноса по категориям для Q-S2. Считать только на локальной БД, к боевой не подключаться.

## ТЗ для исполнителя

### Общие правила
- Строго по ТЗ. Неясное возвращать открытым вопросом. В местах, зависящих от решений, ставить `TODO(Q-Sn)`.
- Без DDL, миграций, `create_all`, новых зависимостей, Redis, TypeScript, i18n.
- Все UI-строки — в `frontend/src/modules/warehouse/strings.js`.
- SQL — через `text()` с полными именами `trendsetter_hub.…`, как в `service.py`.
- Не подключаться к боевой БД. Проверка — на локальном Postgres из compose, куда реальный xlsx переносится командой `legacy_import` (порядок — в `docs/TZ-warehouse-legacy-import.md`, шаг «Verify»). Реальные КИ и почты не попадают ни в код, ни в тесты, ни в отчёт.

### Можно менять или создавать
- `backend/app/modules/warehouse/service.py` — только новая функция `receipt_state`.
- `backend/app/modules/warehouse/router.py` — только новый маршрут.
- `backend/tests/test_warehouse.py` — только новые тесты в конце файла.
- `frontend/src/modules/warehouse/lib/hydrate.js` (новый), `lib/hydrate.test.js` (новый).
- `frontend/src/modules/warehouse/lib/httpBackend.js`, `lib/localBackend.js` — по одной функции.
- `frontend/src/modules/warehouse/store.js`.
- `frontend/src/modules/warehouse/components/{Header,ScanArea,SidePanel,ClosedTable}.jsx`.
- `frontend/src/modules/warehouse/strings.js`.
- `frontend/src/modules/warehouse/README.md` — абзац в разделе «Данные».

### Нельзя менять
- `legacy_import.py`;
- существующие функции `service.py` (`sync`, `assign_pallet`, `reopen_box`, `register_mark` и остальные);
- `db/**`, `backend/alembic/**`, `backend/app/core/**`, `conftest.py`, существующие тесты;
- `lib/{plan,csv,format,marks,print,code128}.js`;
- `PlanPanel.jsx`, `Dialogs.jsx` (кроме случая из шага 3.7), `WarehousePage.jsx`;
- `frontend/src/core/**`, `vite.config.js`, `deploy/**`, `CLAUDE.md`, `ARCHITECTURE.md`.

Регулярку `/^Google/` в `store.js:311` не трогать.

### Шаг 1. Бэкенд

`service.receipt_state(session, name: str, full: bool) -> dict`:
1. `rid = receipt_id(session, name)`: неизвестная приёмка → 422, как везде.
2. Из того же запроса взять каноническое `name` и `status`.
3. **Сначала сканы, потом короба. Порядок обязателен:** при чтении наоборот короб, закрытый между запросами, будет выглядеть открытым. Сканы:
   ```
   SELECT id, scanned_at, worker, box_category, box_code, barcode, status, no_cz, ki,
          CASE WHEN :full THEN full_code END AS full_code
   FROM trendsetter_hub.warehouse_scans WHERE receipt_id = :r ORDER BY scanned_at, id
   ```
   В ответ идут компактные массивы: `[id, ms(scanned_at), worker, box_category, box_code, barcode, status, no_cz, ki or "", full_code or ""]`.
4. Закрытые короба приёмки:
   ```
   SELECT b.code, b.category, b.item_count, b.worker, b.opened_at, b.closed_at,
          s.pallet_code, s.section, s.pallet_no, s.pos
   FROM trendsetter_hub.warehouse_boxes b
   LEFT JOIN (SELECT box_code, pallet_code, section, pallet_no,
                     row_number() OVER (PARTITION BY pallet_code ORDER BY placed_at, box_code) AS pos
              FROM trendsetter_hub.warehouse_storage_boxes) s ON s.box_code = b.code
   WHERE b.receipt_id = :r ORDER BY b.closed_at DESC, b.code
   ```
   Элемент ответа: `{code, box: category, count: item_count, worker, opened: ms или None, closedAt: ms, pallet: pallet_code or "", storage: {code, sector, pallet, pos, cap: cap(pallet_no), box: code} | None}`.
   - Поле `opened`: если `opened_at` NULL — `None`. Существующий `ms()` для этого не годится, он подставляет текущее время.
   - Поле `storage` совпадает по форме с тем, что возвращает `_stor_info`: оно нужно для печати этикетки закрытого короба (`labelHTML`).
5. Без `commit`, без `log_action`.
6. Возвращает `{"receipt", "status", "scans", "closed"}`.

Маршрут: `@router.get("/receipt-state")` с параметрами `receipt: str`, `full: bool = False`, `_: User = Run`, `session: Session = Db`.

### Шаг 2. `lib/hydrate.js` — чистые функции без localStorage и React

**`fromRow(row)`** — строка снимка в скан формата браузера:
- обычный скан: `{id, t, worker, box, boxCode, bc: barcode, status, noCz}`;
- если `ki` есть: `bc: ki, ki, ean: barcode, gtin: ki.slice(2,16)`, плюс `full`, если он передан.

**`nKey(scan, plan)`** — по таблице ключей из раздела «Что выяснено». Если `plan` нет, считать `kiCount = 0`. Хранимое `s.n` не использовать: ключ всегда вычисляется по раскладке.

**`merge(db, st, opts)`**, где `opts = {plan, undone: Set, reopened: Set, queue}`. Возвращает `{receipt, scans, fact, alloc, closed, orphans, closedElsewhere}`. Правила, каждое покрыть тестом:

1. **Другая приёмка.** Если `!db` или `db.receipt.toLowerCase() !== st.receipt.toLowerCase()`, результат строится только из `st`: сканы, закрытые короба, `fact` и `alloc` пересчитываются из `st.scans`. `orphans` пуст.

2. **Закрытые короба.**
   - Берутся короба снимка, кроме кодов из `reopened`.
   - Добавляются короба из `st.closed`, которых нет в снимке (сравнение по `code`).
   - Сортировка по `closedAt` по убыванию.

3. **Сканы.**
   - Берутся сканы снимка, кроме id из `undone`.
   - Если временный код скана `C` совпадает по `boxId()` с кодом закрытого короба `X` из п. 2, а `C !== X`, то `boxCode` такого скана заменяется на `X`. Это гонка между запросами или ещё не отправленный `close`.
   - Если скан с тем же id есть в `st.scans`, берётся локальная версия: у неё уже свежий `boxCode`.
   - Добавляются сканы из `st.scans`, которых нет в снимке. Сюда попадают неотправленные, отправленные после снимка и ждущие номер короба (`pend`, `boxCode: null`).
   - Итог сортируется по `t`, затем по `id`.
   - Один id учитывается ровно один раз.

4. **`fact` и `alloc`.**
   - `fact[box]` — число сканов из п. 3.
   - `alloc[nKey][box]` — только `status === 'ok'`.

5. **`orphans`** — открытые в БД короба, не открытые на этом ПК. Это коды сканов из п. 3 с `boxCode`, не равным null, которые:
   - не попали в закрытые;
   - не совпадают по `boxId` ни с одним кодом из `st.boxes`;
   - не стоят в `boxCode` или `tmp` ни одной операции `close` из `queue`.

   Элемент: `{code, box, count, opened: min t, last: max t, worker: worker последнего скана}`. Сортировка по `last` по убыванию.

6. **`closedElsewhere`** — коды из `st.boxes`, которые совпадают по `boxId` с закрытым коробом снимка и при этом не закрыты на этом ПК, то есть их нет в `st.closed` и в `close` из очереди.

7. **Чистота.** Функция не меняет `db`, `st` и `opts`. Повторный вызов с теми же данными даёт тот же результат.

### Шаг 3. `store.js` и компоненты

**3.1. Новые функции бэкендов.**
- `httpBackend.receiptState: (r, full) => api.get(`${base}/receipt-state?receipt=${enc(r)}${full ? '&full=true' : ''}`)`.
- `localBackend.receiptState() { return null }`. При `shared: false` снимок не запрашивается вовсе, демо работает как сейчас.

**3.2. Новое состояние в `S`, только в памяти.**
- `S.db = null`;
- `S.dbMsg = ''`;
- наборы `S.undone`, `S.reopened` — `Set`.

**3.3. `refreshDb(full = false)`** — async, при `!backend.shared` или пустом `st.receipt` ничего не делает.
1. Взять номер запроса `++dbReq`.
2. `S.undone = new Set(ссылки undo из S.q)`.
3. `S.reopened = new Set()`.
4. Запросить снимок.
5. Если пришёл ответ на устаревший запрос или приёмка уже другая — выбросить.
6. Иначе `S.db = {receipt, status, scans: rows.map(fromRow), closed}`, затем `emit()`.

При ошибке `S.db` не трогать, показать `showTarget('err msg', …)` с текстом из `strings`. Блокировать сканирование и `flush` на время запроса не нужно: дедупликация по id делает это лишним.

Где набор пополняется:
- в `undo()` после отправки `undo` в очередь — `S.undone.add(s.id)`;
- в `reopenByCode` после успеха — `S.reopened.add(code)`.

Больше пути записи не меняются.

**3.4. `view()`** — `merge(S.db, S.st, {plan: S.plan, undone, reopened, queue: S.q})`, кэш по счётчику `version`. Экспорт: `export const view`.

**3.5. Маршрутизация по всей приёмке.**
- В `handleScan` и `czScan` заменить `st.alloc` на `view().alloc` в вызовах `route` и `routeMarked`.
- В `czScan` проверку `st.scans.some(s => s.ki === p.ki)` заменить на ту же проверку по `view().scans`.
- В `recordScan` сообщение «N из M в коробке» показывает количество по всей приёмке, включая текущий скан: значение из `view()` до записи плюс 1.
- `st.alloc` и `st.fact` продолжают обновляться как сейчас, их больше никто не читает. Не удалять.

**3.6. Когда вызывать `refreshDb`.**
- В `switchReceipt` после `pullPlan`/`sharePlan`: `await refreshDb()`, затем `offerOrphans()`.
- В `boot()`, если `st.receipt` есть: после `pullPlan` — `refreshDb().then(offerOrphans)`.

**3.7. `offerOrphans()`** — `TODO(Q-S1, Q-S7)`.
- Если в `view().orphans` есть коды, не отклонённые в этой сессии, показать `choose(...)`: список из кода, коробки, количества, сотрудника, времени последнего скана и предупреждения «если короб сейчас открыт на другом ПК — не берите». Кнопки: «Не брать» и «Продолжить на этом ПК».
- При согласии, для каждой коробки `k`, если на ПК её ячейка пуста (`!st.boxes[k]?.box`): `st.boxes[k] = {box: {code, opened, base: count, adopted: true}, items: []}`. Если в одной коробке несколько кодов, берётся самый свежий. Остальные и занятые попадают в одно сообщение `showTarget('err msg', …)`.
- Отклонённые коды запоминаются в памяти до перезагрузки.
- `persist()`, `emit()`.

Если в этом месте понадобится правка `Dialogs.jsx`, не правьте: верните открытым вопросом. Существующий `choose` принимает текст с переводами строк.

**3.8. `closedElsewhere`.** После `refreshDb` для каждого такого кода:
- если в `S.q` и `st.pend` нет операций с этим `boxCode`, сбросить ячейку в `{box: null, items: []}` и показать предупреждение «короб закрыт на другом ПК»;
- иначе только предупреждение.

**3.9. Выгрузки.** `exportTxt`, `exportKiz`, `exportCopy`, `exportByBox`, `exportDiff` становятся async.
1. При `shared` сначала `await refreshDb(exportByBox ? true : false)`.
2. Если запрос не удался — `showTarget('err msg', <нет связи с базой, выгрузка не сделана>)` и выход. `TODO(Q-S4)`.
3. Строить из `view()`: `allLines(v)`, `kizLines(v)`, `byBoxCsv(v, S.cfg, pm)`, `diffCsv(v, S.plan)`.
4. Проверки «пусто» тоже по `view()`.
5. `exportByBox` запрашивает палеты по `boxCode` из `view().scans`.

**3.10. Компоненты.**
- **`ScanArea.jsx`** — плитки по `view()`, `TODO(Q-S3)`:
  - отсканировано — `scans.length`;
  - ожидается — без изменений, `plan.total` из общей раскладки;
  - нет в файле — `unknown + foreign`;
  - излишки — `extra`, новая плитка, класс `bad`;
  - коробов закрыто — `closed.length`.
- **`SidePanel.jsx`**:
  - в `Grid` заменить `st.fact[k]` на `view().fact[k]`;
  - тег для `c.box.adopted` — новая строка `side.adopted`;
  - журнал — `view().scans.slice(-60)`.
- **`ClosedTable.jsx`**:
  - источник — `view().closed`;
  - `printClosed(i)` берёт запись из `view().closed[i]`;
  - если `opened` равно `null`, пустая ячейка.

**3.11. Строки** в `strings.js`:
- новые: плитка «излишки», `side.adopted`, тексты диалога чужих коробов, «короб закрыт на другом ПК», «нет связи с базой, выгрузка не сделана», «загружаю данные приёмки» (если используется);
- новые ключи добавлять только для новых текстов, существующие не переименовывать.

### Шаг 4. Убрать Google
- Удалить кнопку в `Header.jsx`, строки 84–86.
- Удалить `header.sheet`, `header.sheetOffTitle`, `header.sheetOffSub` из `strings.js`.
- `plan.sheet` («Лист») не трогать.

### Шаг 5. Тесты

**Бэкенд**, новые тесты в `test_warehouse.py`:
1. Без токена — 401. `viewer` и сотрудник «Закупок» — 403. Сотрудник склада — 200.
2. Неизвестная приёмка → 422.
3. Две приёмки. В первую через `sync` отправить сканы со статусами `ok`, `unknown`, `extra`, `foreign`, «без ЧЗ» и с `ki`/`full`. Дальше:
   - короб A — `assign` и `close` с заменой временного кода;
   - короб B — `close` без `assign`, палета нет;
   - короб C — закрыть, потом `reopen`.

   В ответе проверить:
   - сканов второй приёмки нет;
   - порядок по `(scanned_at, id)`, `t` в мс равно исходному;
   - у сканов A итоговый код;
   - в `closed` есть A с `storage` (`code`, `sector`, `pallet`, `pos`, `cap`) и B с `storage = None`, а C нет;
   - `full_code` пуст без `full=true` и заполнен с ним;
   - `len(scans)`, разбивка по статусам и `len(closed)` равны `scanned`, `not_in_file`, `surplus`, `boxes_closed` из `warehouse_receipt_summary`.
4. Только чтение: после GET число строк в `warehouse_*` и `audit_log` не изменилось.

**Фронтенд**, `hydrate.test.js` через `node --test`:
- `fromRow` для обычного скана, скана ЧЗ и скана «без ЧЗ»;
- `nKey` — 4 случая из таблицы;
- каждое правило 1–7 из шага 2 отдельно;
- скан в снимке и в `st.scans` с одним id учитывается один раз;
- `undone` убирает скан снимка;
- `reopened` убирает короб снимка;
- неотправленный `close`: короб закрыт, сканы с итоговым кодом, в `orphans` его нет;
- временный код плюс закрытый `X` с тем же `boxId` дают замену кода;
- скан из `pend` с `boxCode: null` учитывается;
- **совпадение выгрузок:** если «снимок равен локальному состоянию», то `allLines`, `kizLines`, `diffCsv`, `byBoxCsv` дают тот же текст, что из `st`. Проверить на сканах ЧЗ, «без ЧЗ» и излишков;
- **маршрутизация:** при `hasQty` и квоте, выбранной сканами снимка, `route(plan, merge(...).alloc, n)` возвращает `{box: '20', status: 'extra'}`.

### Отчёт исполнителя
- вывод `pytest`, `npm test`, `npm run lint`, `npm run build`;
- список файлов;
- поставленные `TODO(Q-S*)`;
- замеры на локальной БД с переносом реального файла:
  - размер JSON `receipt-state` для «Новой Моды» с `full` и без, время ответа;
  - длина `whf_state` до и после выбора приёмки на чистом профиле;
- распределение временных кодов «Новой Моды»: сколько кодов, в каких коробках, сколько коробок с более чем одним открытым кодом. Без КИ и почт;
- отклонения от ТЗ, найденное, но не исправленное.

## Критерии приёмки для ревьюера
- **Объём диффа.** Изменены только разрешённые файлы. Нет DDL, миграций, правок существующих функций `service.py` и существующих тестов, `legacy_import.py`, `core/**`, `lib/{plan,csv,format,marks,print}.js`.
- **Эндпоинт.**
  - `GET /modules/warehouse/receipt-state` только читает: нет `commit` и `log_action`, тест 4 зелёный.
  - Право `Run`, тест 1. Неизвестная приёмка → 422.
  - Сканы читаются раньше коробов.
  - Позиция на палете считается одним запросом с `row_number()`, без вызова `_stor_info` в цикле.
- **Снимок не попадает в localStorage.** `S.db` нигде не передаётся в `save()`. Длина `whf_state` после выбора «Новой Моды» на чистом профиле — порядка килобайт, а не мегабайт (по отчёту).
- **Пути записи не изменились:**
  - `recordScan`, `undo`, `closeBox`, `enqueue`, `flush`, `sync` не трогались, кроме пополнения `S.undone` и `S.reopened` и источника `alloc` в маршрутизации;
  - в `markReg` не добавляются КИ из снимка;
  - `registerMark` и `sync` для гидрированных сканов не вызываются;
  - `undo` по-прежнему проходит только по `st.scans`.
- **Слияние.** `merge` чистая. Правила 1–7 и пункты тестов из шага 5 покрыты, `npm test` зелёный. Один id никогда не считается дважды.
- **Ключ `n`.** Вычисляется по `nKey` и раскладке. Тесты на совпадение выгрузок и на маршрутизацию излишков зелёные.
- **Сценарий Романа** (локальная БД с переносом, чистый профиль браузера, выбор «Новая Мода(14.10)»):
  - плитки «отсканировано», «нет в файле», «излишки», «закрыто» совпадают с `warehouse_receipt_summary` (`scanned`, `not_in_file`, `surplus`, `boxes_closed`; ожидается 416 закрытых);
  - «ожидается» равно `plan.total` общей раскладки;
  - список закрытых коробов полный, с палетами; «Печать» печатает этикетку с секцией и палетом;
  - `fact` по ячейкам равен `GROUP BY box_category`;
  - скан баркода, у которого квота уже выбрана, уходит в 20 «излишек»;
  - после F5 те же цифры;
  - на втором профиле браузера те же цифры.
- **Очередь.** Офлайн-скан (запрос в Network заблокирован): счётчик +1 сразу. После восстановления сети и `refreshDb` +0, двойного счёта нет. Отмена скана, уже отправленного на сервер, до перечитывания снимка уменьшает счётчик сразу.
- **Чужие открытые короба.** Без подтверждения на ПК не появляются. После «Продолжить на этом ПК» короб виден с тегом и `base = count`, «Отменить» его вещи не трогает. При закрытии сканы получают итоговый код, строка в `warehouse_boxes` с верным `item_count`, на палете одно место.
- **Выгрузки.** Перечитывают снимок. При недоступном API — ошибка и файла нет. «По коробкам» содержит «Код ЧЗ полностью» (`full=true`). Содержимое совпадает с SQL-выборкой по приёмке.
- **Демо.** В режиме без `VITE_API_URL` снимок не запрашивается, поведение прежнее.
- **Google.** Кнопки «Раскладка из Google Таблицы» нет. В `frontend/src/modules/warehouse` нет строк `sheetOff*`. `/^Google/` в `store.js` на месте.
- **Строки и качество.** Все новые UI-строки в `strings.js`. `TODO(Q-S1, Q-S3, Q-S4, Q-S7)` стоят там, где указано. `npm run lint`, `npm run build`, `pytest` зелёные. Реальных КИ и почт в диффе нет.

## Риски
- **Два ПК продолжают один открытый короб** — главный риск. `assign_pallet` проверяет только итоговый код, поэтому возможны два места хранения на один физический короб. Защита: подтверждение с предупреждением, `closedElsewhere`, организационное правило (Q-S1). Серверную защиту оставить на отдельную задачу.
- **Ответ около 1–2 МБ** для «Новой Моды». Без `full` меньше, но сжатие на nginx в этой задаче не настраиваем. Замер — в отчёте.
- **`navigator.clipboard` после `await`** может потерять право на запись в буфер. В коде уже есть запасной путь через `execCommand`.
- **Цифры на двух ПК не обновляются сами.** Перечитывание только при выборе приёмки, F5 и выгрузке (Q-S5).
- **Уже существующая особенность, не исправлять в этой задаче:** `undo` после переоткрытия на том же ПК может отменить скан, сделанный до переоткрытия, без уменьшения `base`.

## Открытые вопросы (с рекомендацией)
- **Q-S1. Открытые в БД короба, которые не открыты на этом ПК.**
  - Рекомендация: брать на ПК только после подтверждения в диалоге, плюс правило склада «один открытый короб ведёт один ПК».
  - Альтернатива: только показывать, без возможности продолжить. Тогда продолжить приёмку с другого ПК можно только для закрытых коробов.
- **Q-S2. 482 скана из переноса во временных кодах.** Технически их можно взять на ПК и закрыть в хабе: получат палет и итоговый код.
  - Рекомендация: закрывать, если физические короба есть и на них старые этикетки с временным номером. Иначе оставить историей: короба будут постоянно предлагаться в диалоге, пока их кто-то не отклонит.
  - Если часть из них в завершённой «Daisyknit…», через интерфейс их не достать.
  - Нужны цифры распределения из отчёта.
  - Отдельно поправить формулировку Q-M2 в `TZ-warehouse-legacy-import.md` — это отдельная задача.
- **Q-S3. Плитки.** Рекомендация: разделить «нет в файле» (`unknown + foreign`) и «излишки» (`extra`), всего 5 плиток, как в Сводке и в формулировке задачи. Альтернатива: оставить 4 плитки, как в исходном приложении.
- **Q-S4. Выгрузка без связи с базой.** Рекомендация: отказ с ошибкой, потому что неполный список баркодов или КИЗ опасен. Альтернатива: выгрузка по данным на экране с явной пометкой.
- **Q-S5. Обновление цифр между ПК.** Рекомендация: в этой задаче только выбор приёмки, F5 и выгрузки. Кнопку «Обновить из базы» или опрос раз в 60 с — отдельной задачей, если нужно.
- **Q-S6. Завершённые приёмки** (Daisyknit) в списке не видны. Рекомендация: просмотр завершённых — отдельная задача.
- **Q-S7. Несколько открытых кодов в одной коробке.** Рекомендация: на ПК берётся самый свежий, остальные показываются списком в сообщении.

## Ключевые файлы
- `C:\Users\Administrator\OneDrive\Desktop\Claude\WORK\ProjectNewDashboard\backend\app\modules\warehouse\service.py`
- `C:\Users\Administrator\OneDrive\Desktop\Claude\WORK\ProjectNewDashboard\backend\app\modules\warehouse\router.py`
- `C:\Users\Administrator\OneDrive\Desktop\Claude\WORK\ProjectNewDashboard\backend\tests\test_warehouse.py`
- `C:\Users\Administrator\OneDrive\Desktop\Claude\WORK\ProjectNewDashboard\db\modules\warehouse\001_warehouse.sql`
- `C:\Users\Administrator\OneDrive\Desktop\Claude\WORK\ProjectNewDashboard\frontend\src\modules\warehouse\store.js`
- `C:\Users\Administrator\OneDrive\Desktop\Claude\WORK\ProjectNewDashboard\frontend\src\modules\warehouse\lib\` (`httpBackend.js`, `localBackend.js`, `csv.js`, `plan.js`, `format.js`, `print.js`)
- `C:\Users\Administrator\OneDrive\Desktop\Claude\WORK\ProjectNewDashboard\frontend\src\modules\warehouse\components\` (`Header.jsx`, `ScanArea.jsx`, `SidePanel.jsx`, `ClosedTable.jsx`)
- `C:\Users\Administrator\OneDrive\Desktop\Claude\WORK\ProjectNewDashboard\frontend\src\modules\warehouse\strings.js`
- `C:\Users\Administrator\OneDrive\Desktop\Claude\WORK\ProjectNewDashboard\docs\TZ-warehouse-legacy-import.md`

## Решения пользователя (2026-10-19) — приоритетнее текста выше
- Q-S1 + Q-S2: чужие открытые короба и 482 скана из переноса НЕ берутся на ПК, только история. Из шага 3 исключить `offerOrphans`, диалог, `adopted` (тег `side.adopted`, `base` из снимка) и `orphans` из `merge` (правило 5 и его тесты). Правило 6 (`closedElsewhere`) оставить. TODO(Q-S1, Q-S7) не нужны. Если после теста склада данные заменят новым файлом или начнут с чистого листа — переносить заново.
- Q-S3: 5 плиток (нет в файле = unknown+foreign, излишки = extra отдельно).
- Q-S4: если снимок не получен — красное предупреждение, но выгрузка выполняется по последнему снимку (если был) или по локальному состоянию ПК, с пометкой в сообщении, что данные могут быть неполными.
- Q-S5, Q-S6, Q-S7: по рекомендации (Q-S7 теперь неактуален).
