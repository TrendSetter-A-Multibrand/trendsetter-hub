// Mock модуля HR, часть «people-ops»: история, оборудование, чек-листы (онбординг/оффбординг), экспорт в Excel.
// Контракт — docs/TZ-hr-people-ops.md, раздел «API». План отпусков, дни рождения и «мои документы» — в других файлах.
// Все люди вымышленные. Данные in-memory (у каждой фабрики своё хранилище), сбрасываются при перезагрузке страницы.
// Права: Me — любой активный; Hr — run на hr; Resp — responsible на hr. Исполнитель пункта чек-листа (не HR) отмечает только свой пункт.
import { ApiError } from '../client.js'
import strings from '../../../modules/hr/strings.js'
import { addDays, countDays, formatDate, isIsoDate, todayIso } from '../../dates.js'
import { data as hub } from './data.js'
import { completeness } from '../../../modules/hr/lib/completeness.js'
import {
  CHECKLIST_KINDS, DAYS_OFFSET_MAX, EQUIPMENT_KINDS, EQUIPMENT_MAX_COUNT, EQUIPMENT_NAME_LIMIT, EQUIPMENT_TEXT_LIMIT, HISTORY_KINDS,
  HISTORY_TEXT_LIMIT, HISTORY_TITLE_LIMIT, ITEM_NOTE_LIMIT, ITEM_TITLE_LIMIT, TEMPLATE_TITLE_LIMIT, canDeleteHistory, isItemOverdue,
} from '../../../modules/hr/lib/ops.js'

const err = strings.errors
const nf = strings.notify
const xs = strings.exportXlsx
const MAX_RANGE_DAYS = 400
const MAX_TEMPLATE_ITEMS = 50

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const has = (obj, key) => isObject(obj) && obj[key] !== undefined
const deny = (status, message) => new ApiError(status, message)
const strOrNull = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

// null/undefined/пусто -> null; не строка или длиннее limit -> 422
function optText(v, limit, message) {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string' || v.trim().length > limit) throw deny(422, message)
  return v.trim() || null
}
function optDate(v, message) {
  if (v === undefined || v === null || v === '') return null
  if (!isIsoDate(v)) throw deny(422, message)
  return v
}

const DEMO_TEMPLATES = [
  {
    kind: 'onboarding', title: 'Онбординг: новый сотрудник',
    items: [
      ['Создать учётную запись и корпоративную почту', 0], ['Выдать доступ в хаб', 1], ['Выдать оборудование', 2],
      ['Назначить наставника', 3], ['Ознакомить с документами и правилами', 5], ['Провести вводную встречу с руководителем', 7],
    ],
  },
  {
    kind: 'offboarding', title: 'Оффбординг: увольнение',
    items: [
      ['Отметить уволенным в хабе', 0], ['Отключить доступы и учётные записи', 0], ['Вернуть оборудование', 3],
      ['Передать дела и задачи', 5], ['Произвести окончательный расчёт', 5], ['Экспортировать документы', 7],
    ],
  },
]

function seed() {
  const today = todayIso()
  const d = (n) => addDays(today, n)
  const stamp = (n) => `${d(n)}T09:00:00.000Z`
  const next = { history: 1, equipment: 1, template: 1, item: 1, checklist: 1 }

  const templates = DEMO_TEMPLATES.map((t) => ({
    id: next.template++, kind: t.kind, title: t.title, active: true,
    items: t.items.map(([title, daysOffset], i) => ({ id: next.item++, title, sort: i + 1, daysOffset })),
  }))

  const history = [
    { id: next.history++, personId: 11, kind: 'position', effectiveDate: d(-300), title: 'Повышение до менеджера по закупкам', oldValue: 'Младший менеджер', newValue: 'Менеджер по закупкам', comment: null, auto: false, createdBy: 13, createdAt: stamp(-300) },
    { id: next.history++, personId: 11, kind: 'salary', effectiveDate: d(-120), title: 'Пересмотр оклада', oldValue: '120 000', newValue: '140 000', comment: 'По итогам аттестации', auto: false, createdBy: 13, createdAt: stamp(-120) },
    { id: next.history++, personId: 11, kind: 'manager', effectiveDate: d(-45), title: 'Смена руководителя', oldValue: 'Громов Павел', newValue: 'Кравцов Денис', comment: null, auto: true, createdBy: 13, createdAt: stamp(-45) },
    { id: next.history++, personId: 12, kind: 'other', effectiveDate: d(-60), title: 'Пройден курс по аналитике', oldValue: null, newValue: null, comment: 'Сертификат в личном деле', auto: false, createdBy: 9, createdAt: stamp(-60) },
  ]

  const eq = (personId, kind, name, serial, issuedOff, dueOff, returnedOff = null) => ({
    id: next.equipment++, personId, kind, name, serial, issuedAt: d(issuedOff), returnDue: dueOff === null ? null : d(dueOff),
    returnedAt: returnedOff === null ? null : d(returnedOff), comment: null, createdBy: 9, createdAt: stamp(issuedOff),
  })
  const equipment = [
    eq(11, 'laptop', 'Ноутбук демо-модель 14″', 'DEMO-0001', -400, null),
    eq(12, 'monitor', 'Монитор демо 27″', 'DEMO-0417', -90, -5), // просрочен возврат
    eq(13, 'laptop', 'Ноутбук демо-модель 13″', 'DEMO-0932', -70, 2),
    eq(13, 'access_card', 'Пропуск в офис', null, -70, null, -1),
  ]

  // Чек-лист онбординга Захаровой (id 13): два пункта выполнены, два назначены (исполнители 10 и 9) и просрочены
  const onboarding = templates[0]
  const started = d(-10)
  const items = onboarding.items.map((t) => ({
    id: next.item++, title: t.title, sort: t.sort, assigneeUserId: null, dueDate: t.daysOffset === null ? null : addDays(started, t.daysOffset),
    done: false, doneAt: null, doneBy: null, note: null,
  }))
  Object.assign(items[0], { done: true, doneAt: stamp(-10), doneBy: 9, assigneeUserId: 9 })
  Object.assign(items[1], { done: true, doneAt: stamp(-9), doneBy: 13, note: 'Доступ выдан, роль viewer' })
  Object.assign(items[2], { assigneeUserId: 10 })
  Object.assign(items[4], { assigneeUserId: 9 })
  const checklists = [
    { id: next.checklist++, personId: 13, kind: 'onboarding', title: onboarding.title, templateId: onboarding.id, status: 'active', startedAt: started, createdBy: 9, createdAt: stamp(-10), closedAt: null, items },
  ]
  return { history, equipment, templates, checklists, next }
}

// deps: userFromToken, accessTo(user, moduleId), isResponsible(user), team (createTeamHandlers), notify(userIds, notification),
// hr — результат createHrHandlers (store.fileOf, balanceOf, requests). Подписывается на правки карточки команды (автозапись истории).
export function createHrOpsHandlers({ userFromToken, accessTo, isResponsible, team, notify, hr }) {
  const db = seed()
  const BASE = '/modules/hr'

  // ---- права ----
  const ctxHr = (token) => {
    const user = userFromToken(token)
    if (accessTo(user, 'hr') !== 'run') throw deny(403, err.forbidden)
    return user
  }
  const hrUsers = () => hub.users.filter((u) => u.is_active && accessTo(u, 'hr') === 'run')
  const userName = (id) => hub.users.find((u) => u.id === id)?.full_name ?? null
  const personName = (p) => `${p.lastName} ${p.firstName}`
  const findPerson = (id) => {
    const p = team.byId(id)
    if (!p) throw deny(404, err.personNotFound)
    return p
  }
  const find = (list, id, message) => {
    const x = list.find((i) => i.id === Number(id))
    if (!x) throw deny(404, message)
    return x
  }

  // ---- история ----
  const historyOut = (h) => ({
    id: h.id, kind: h.kind, effectiveDate: h.effectiveDate, title: h.title, oldValue: h.oldValue, newValue: h.newValue,
    comment: h.comment, auto: h.auto, createdBy: userName(h.createdBy), createdAt: h.createdAt,
  })
  const addHistory = (personId, fields, createdBy, auto) => {
    const h = {
      id: db.next.history++, personId, kind: fields.kind, effectiveDate: fields.effectiveDate ?? todayIso(), title: fields.title,
      oldValue: fields.oldValue ?? null, newValue: fields.newValue ?? null, comment: fields.comment ?? null, auto, createdBy,
      createdAt: new Date().toISOString(),
    }
    db.history.push(h)
    return h
  }

  // Автозапись при правке карточки: сравниваем значения до/после (форма HR шлёт все поля при каждом сохранении)
  team.onPersonPatched(({ person, before, actor }) => {
    const at = strings.history.autoTitles
    const sv = strings.history.statusValues
    const nameOf = (id) => (id === null || id === undefined ? null : (team.byId(id) ? personName(team.byId(id)) : null))
    const dirOf = (id) => team.directions().find((x) => x.id === id)?.shortName ?? id
    const log = (kind, title, oldValue, newValue) => addHistory(person.id, { kind, title, oldValue, newValue }, actor.id, true)
    if (person.title !== before.title) log('position', at.position, before.title, person.title)
    if (person.managerId !== before.managerId) log('manager', at.manager, nameOf(before.managerId), nameOf(person.managerId))
    if (person.directionId !== before.directionId) log('direction', at.direction, dirOf(before.directionId), dirOf(person.directionId))
    if (person.isArchived !== before.isArchived) {
      log('status', person.isArchived ? at.archived : at.restored, before.isArchived ? sv.archived : sv.active, person.isArchived ? sv.archived : sv.active)
    }
  })

  // ---- оборудование ----
  const equipmentOut = ({ id, kind, name, serial, issuedAt, returnDue, returnedAt, comment }) => ({ id, kind, name, serial, issuedAt, returnDue, returnedAt, comment })

  // ---- шаблоны ----
  const templateOut = (t) => ({
    id: t.id, kind: t.kind, title: t.title, active: t.active,
    items: [...t.items].sort((a, b) => a.sort - b.sort || a.id - b.id).map(({ id, title, sort, daysOffset }) => ({ id, title, sort, daysOffset })),
  })
  function parseTemplateItems(list) {
    if (!Array.isArray(list) || list.length === 0 || list.length > MAX_TEMPLATE_ITEMS) throw deny(422, err.templateInvalid)
    return list.map((raw, i) => {
      const title = isObject(raw) ? strOrNull(raw.title) : null
      if (!title || title.length > ITEM_TITLE_LIMIT) throw deny(422, err.templateInvalid)
      const off = raw.daysOffset
      if (off !== undefined && off !== null && !(Number.isInteger(off) && off >= 0 && off <= DAYS_OFFSET_MAX)) throw deny(422, err.templateInvalid)
      return { id: db.next.item++, title, sort: i + 1, daysOffset: off ?? null }
    })
  }
  const parseTemplateTitle = (v) => {
    const title = strOrNull(v)
    if (!title || title.length > TEMPLATE_TITLE_LIMIT) throw deny(422, err.templateInvalid)
    return title
  }

  // ---- чек-листы ----
  const itemOut = (i) => ({
    id: i.id, title: i.title, sort: i.sort,
    assignee: i.assigneeUserId === null ? null : { id: i.assigneeUserId, name: userName(i.assigneeUserId) },
    dueDate: i.dueDate, done: i.done, doneAt: i.doneAt, doneBy: userName(i.doneBy), note: i.note,
  })
  const checklistOut = (c) => ({
    id: c.id, kind: c.kind, title: c.title, status: c.status, startedAt: c.startedAt,
    items: [...c.items].sort((a, b) => a.sort - b.sort || a.id - b.id).map(itemOut),
  })
  const findChecklist = (id) => find(db.checklists, id, err.checklistNotFound)
  const findItem = (id) => {
    for (const checklist of db.checklists) {
      const item = checklist.items.find((i) => i.id === Number(id))
      if (item) return { checklist, item }
    }
    throw deny(404, err.itemNotFound)
  }
  const activeUser = (id) => hub.users.find((u) => u.id === id && u.is_active)

  function closeChecklist(token, id, status) {
    ctxHr(token)
    const c = findChecklist(id)
    if (c.status !== 'active') throw deny(409, err.checklistNotActive)
    Object.assign(c, { status, closedAt: new Date().toISOString() })
    return checklistOut(c)
  }

  // ---- экспорт ----
  async function toXlsx(sheets) {
    const mod = await import('xlsx')
    const XLSX = mod.default ?? mod
    const wb = XLSX.utils.book_new()
    for (const [name, rows] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
    return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' })
  }

  const handlers = {
    // ---- История ----
    [`GET ${BASE}/people/:id/history`]: ({ token, params }) => {
      const user = ctxHr(token)
      const person = findPerson(params.id)
      const resp = isResponsible(user)
      return db.history
        .filter((h) => h.personId === person.id && (resp || h.kind !== 'salary'))
        .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.id - a.id)
        .map(historyOut)
    },

    [`POST ${BASE}/people/:id/history`]: ({ token, params, body }) => {
      const user = ctxHr(token)
      const person = findPerson(params.id)
      const b = isObject(body) ? body : {}
      if (!HISTORY_KINDS.includes(b.kind)) throw deny(422, err.historyKind)
      if (b.kind === 'salary' && !isResponsible(user)) throw deny(403, err.forbidden)
      if (!isIsoDate(b.effectiveDate)) throw deny(422, err.historyDate)
      const title = strOrNull(b.title)
      if (!title || title.length > HISTORY_TITLE_LIMIT) throw deny(422, err.historyTitle)
      const fields = {
        kind: b.kind, effectiveDate: b.effectiveDate, title,
        oldValue: optText(b.oldValue, HISTORY_TEXT_LIMIT, err.historyText),
        newValue: optText(b.newValue, HISTORY_TEXT_LIMIT, err.historyText),
        comment: optText(b.comment, HISTORY_TEXT_LIMIT, err.historyText),
      }
      return historyOut(addHistory(person.id, fields, user.id, false))
    },

    // Resp удаляет любые записи, Hr — только ручные и не salary
    [`POST ${BASE}/history/:id/delete`]: ({ token, params }) => {
      const user = ctxHr(token)
      const entry = find(db.history, params.id, err.historyNotFound)
      if (!canDeleteHistory(entry, isResponsible(user))) throw deny(403, err.forbidden)
      db.history = db.history.filter((h) => h !== entry)
      return { ok: true }
    },

    // ---- Оборудование ----
    [`GET ${BASE}/people/:id/equipment`]: ({ token, params }) => {
      ctxHr(token)
      const person = findPerson(params.id)
      return db.equipment
        .filter((e) => e.personId === person.id)
        .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt) || b.id - a.id)
        .map(equipmentOut)
    },

    [`POST ${BASE}/people/:id/equipment`]: ({ token, params, body }) => {
      const user = ctxHr(token)
      const person = findPerson(params.id)
      const b = isObject(body) ? body : {}
      if (!EQUIPMENT_KINDS.includes(b.kind)) throw deny(422, err.equipmentKind)
      const name = strOrNull(b.name)
      if (!name || name.length > EQUIPMENT_NAME_LIMIT) throw deny(422, err.equipmentName)
      if (!isIsoDate(b.issuedAt)) throw deny(422, err.historyDate)
      const item = {
        id: db.next.equipment, personId: person.id, kind: b.kind, name, serial: optText(b.serial, EQUIPMENT_NAME_LIMIT, err.equipmentName),
        issuedAt: b.issuedAt, returnDue: optDate(b.returnDue, err.historyDate), returnedAt: null,
        comment: optText(b.comment, EQUIPMENT_TEXT_LIMIT, err.historyText), createdBy: user.id, createdAt: new Date().toISOString(),
      }
      if (db.equipment.filter((e) => e.personId === person.id).length >= EQUIPMENT_MAX_COUNT) throw deny(409, err.equipmentLimit)
      db.next.equipment += 1
      db.equipment.push(item)
      return equipmentOut(item)
    },

    [`PATCH ${BASE}/equipment/:id`]: ({ token, params, body }) => {
      ctxHr(token)
      const item = find(db.equipment, params.id, err.equipmentNotFound)
      const b = isObject(body) ? body : {}
      const next = { ...item }
      if (has(b, 'kind')) {
        if (!EQUIPMENT_KINDS.includes(b.kind)) throw deny(422, err.equipmentKind)
        next.kind = b.kind
      }
      if (has(b, 'name')) {
        const name = strOrNull(b.name)
        if (!name || name.length > EQUIPMENT_NAME_LIMIT) throw deny(422, err.equipmentName)
        next.name = name
      }
      if (has(b, 'serial')) next.serial = optText(b.serial, EQUIPMENT_NAME_LIMIT, err.equipmentName)
      if (has(b, 'comment')) next.comment = optText(b.comment, EQUIPMENT_TEXT_LIMIT, err.historyText)
      if (has(b, 'issuedAt')) {
        if (!isIsoDate(b.issuedAt)) throw deny(422, err.historyDate)
        next.issuedAt = b.issuedAt
      }
      if (has(b, 'returnDue')) next.returnDue = optDate(b.returnDue, err.historyDate)
      if (has(b, 'returnedAt')) next.returnedAt = optDate(b.returnedAt, err.historyDate)
      Object.assign(item, next)
      return equipmentOut(item)
    },

    [`POST ${BASE}/equipment/:id/delete`]: ({ token, params }) => {
      ctxHr(token)
      const item = find(db.equipment, params.id, err.equipmentNotFound)
      db.equipment = db.equipment.filter((e) => e !== item)
      return { ok: true }
    },

    // ---- Шаблоны чек-листов ----
    [`GET ${BASE}/checklist-templates`]: ({ token }) => {
      ctxHr(token)
      return db.templates.map(templateOut)
    },

    [`POST ${BASE}/checklist-templates`]: ({ token, body }) => {
      ctxHr(token)
      const b = isObject(body) ? body : {}
      if (!CHECKLIST_KINDS.includes(b.kind)) throw deny(422, err.templateInvalid)
      const title = parseTemplateTitle(b.title)
      const t = { id: db.next.template++, kind: b.kind, title, active: true, items: parseTemplateItems(b.items) }
      db.templates.push(t)
      return templateOut(t)
    },

    [`PATCH ${BASE}/checklist-templates/:id`]: ({ token, params, body }) => {
      ctxHr(token)
      const t = find(db.templates, params.id, err.templateNotFound)
      const b = isObject(body) ? body : {}
      const title = has(b, 'title') ? parseTemplateTitle(b.title) : t.title
      if (has(b, 'active') && typeof b.active !== 'boolean') throw deny(422, err.templateInvalid)
      const items = has(b, 'items') ? parseTemplateItems(b.items) : t.items
      Object.assign(t, { title, items, active: has(b, 'active') ? b.active : t.active })
      return templateOut(t)
    },

    // ---- Чек-листы сотрудника ----
    [`GET ${BASE}/people/:id/checklists`]: ({ token, params }) => {
      ctxHr(token)
      const person = findPerson(params.id)
      const rank = (c) => (c.status === 'active' ? 0 : 1)
      return db.checklists
        .filter((c) => c.personId === person.id)
        .sort((a, b) => rank(a) - rank(b) || b.startedAt.localeCompare(a.startedAt) || b.id - a.id)
        .map(checklistOut)
    },

    [`POST ${BASE}/people/:id/checklists`]: ({ token, params, body }) => {
      const user = ctxHr(token)
      const person = findPerson(params.id)
      const b = isObject(body) ? body : {}
      const template = find(db.templates, b.templateId, err.templateNotFound)
      if (!template.active) throw deny(422, err.templateInactive)
      if (has(b, 'startedAt') && b.startedAt !== null && !isIsoDate(b.startedAt)) throw deny(422, err.historyDate)
      const startedAt = b.startedAt ?? todayIso()
      const c = {
        id: db.next.checklist++, personId: person.id, kind: template.kind, title: template.title, templateId: template.id, status: 'active',
        startedAt, createdBy: user.id, createdAt: new Date().toISOString(), closedAt: null,
        items: [...template.items].sort((a, b2) => a.sort - b2.sort).map((t, i) => ({
          id: db.next.item++, title: t.title, sort: i + 1, assigneeUserId: null, dueDate: t.daysOffset === null ? null : addDays(startedAt, t.daysOffset),
          done: false, doneAt: null, doneBy: null, note: null,
        })),
      }
      db.checklists.push(c)
      return checklistOut(c)
    },

    // HR правит любой пункт; назначенный исполнитель (не HR) — только done и note своего пункта
    [`PATCH ${BASE}/checklist-items/:id`]: ({ token, params, body }) => {
      const user = userFromToken(token)
      const { checklist, item } = findItem(params.id)
      const isHr = accessTo(user, 'hr') === 'run'
      if (!isHr && item.assigneeUserId !== user.id) throw deny(404, err.itemNotFound) // как у backend: чужие пункты для не-HR «не существуют»
      const b = isObject(body) ? body : {}
      if (!isHr && (has(b, 'assigneeUserId') || has(b, 'dueDate'))) throw deny(403, err.forbidden)
      if (checklist.status !== 'active') throw deny(409, err.checklistNotActive)
      if (has(b, 'done') && typeof b.done !== 'boolean') throw deny(422, err.itemInvalid)
      if (has(b, 'assigneeUserId') && b.assigneeUserId !== null && !activeUser(b.assigneeUserId)) throw deny(422, err.assigneeInvalid)
      const dueDate = has(b, 'dueDate') ? optDate(b.dueDate, err.itemInvalid) : item.dueDate
      const note = has(b, 'note') ? optText(b.note, ITEM_NOTE_LIMIT, err.itemInvalid) : item.note

      const assigneeChanged = has(b, 'assigneeUserId') && b.assigneeUserId !== item.assigneeUserId
      if (has(b, 'assigneeUserId')) item.assigneeUserId = b.assigneeUserId
      Object.assign(item, { dueDate, note })
      if (has(b, 'done') && b.done !== item.done) {
        Object.assign(item, b.done ? { done: true, doneAt: new Date().toISOString(), doneBy: user.id } : { done: false, doneAt: null, doneBy: null })
      }
      const person = team.byId(checklist.personId)
      if (assigneeChanged && item.assigneeUserId !== null && item.assigneeUserId !== user.id) {
        notify([item.assigneeUserId], { kind: 'checklist_assigned', title: nf.assignedTitle, body: nf.assignedBody(item.title, personName(person)), link: '/modules/hr' })
      }
      if (checklist.items.every((i) => i.done)) {
        Object.assign(checklist, { status: 'done', closedAt: new Date().toISOString() })
        notify(hrUsers().map((u) => u.id), {
          kind: 'checklist_done', title: nf.checklistDoneTitle, body: nf.checklistDoneBody(checklist.title, personName(person)), link: '/modules/hr',
        })
      }
      return itemOut(item) // как у backend: ответ — пункт; статус чек-листа клиент перечитывает списком
    },

    [`POST ${BASE}/checklists/:id/close`]: ({ token, params }) => closeChecklist(token, params.id, 'done'),
    [`POST ${BASE}/checklists/:id/cancel`]: ({ token, params }) => closeChecklist(token, params.id, 'cancelled'),

    // Обзор чек-листов для вкладки HR: сначала с просрочкой, затем по дате старта
    [`GET ${BASE}/checklists`]: ({ token, query }) => {
      ctxHr(token)
      const status = query.status ?? 'active'
      if (status !== 'all' && !['active', 'done', 'cancelled'].includes(status)) throw deny(422, err.invalid)
      const t = todayIso()
      return db.checklists
        .filter((c) => status === 'all' || c.status === status)
        .map((c) => ({
          id: c.id, personId: c.personId, personName: personName(team.byId(c.personId)), kind: c.kind, title: c.title, status: c.status,
          startedAt: c.startedAt, progress: { done: c.items.filter((i) => i.done).length, total: c.items.length },
          overdue: c.items.filter((i) => isItemOverdue(i, t)).length,
        }))
        .sort((a, b) => Number(b.overdue > 0) - Number(a.overdue > 0) || a.startedAt.localeCompare(b.startedAt) || a.id - b.id)
    },

    // Мои пункты (любой активный): назначенные мне в чек-листах «в работе»
    [`GET ${BASE}/checklists/mine`]: ({ token }) => {
      const user = userFromToken(token)
      return db.checklists
        .filter((c) => c.status === 'active')
        .flatMap((c) => c.items.filter((i) => i.assigneeUserId === user.id).map((i) => ({
          checklistId: c.id, itemId: i.id, personName: personName(team.byId(c.personId)), checklistTitle: c.title, title: i.title, dueDate: i.dueDate, done: i.done,
        })))
        .sort((a, b) => Number(a.done) - Number(b.done) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.itemId - b.itemId)
    },

    // ---- Экспорт (Hr). Деньги, паспорта и документы в файл не попадают ----
    [`GET ${BASE}/export/people`]: async ({ token }) => {
      ctxHr(token)
      const [people, fields] = await Promise.all([
        team.handlers['GET /modules/team/hr/people']({ token }),
        team.handlers['GET /modules/team/hr/fields']({ token }),
      ])
      const nameById = new Map(people.map((p) => [p.id, p.name]))
      const dirById = new Map(team.directions().map((x) => [x.id, x.shortName]))
      const rows = people.map((p) => {
        const file = hr.store.fileOf(p.id)
        return [
          p.name, p.title, dirById.get(p.directionId) ?? '', nameById.get(p.managerId) ?? '',
          p.isArchived ? xs.statusDismissed : xs.statusWorking, strings.policies.countries[file.country] ?? '', formatDate(file.hiredAt),
          completeness(fields, p).percent, p.email ?? '', p.telegram ?? '', p.location ?? '', p.workFormat ?? '',
        ]
      })
      return { fileName: `people_${todayIso()}.xlsx`, dataBase64: await toXlsx([[xs.peopleSheet, [xs.peopleColumns, ...rows]]]) }
    },

    [`GET ${BASE}/export/leave`]: async ({ token, query }) => {
      ctxHr(token)
      const { from, to } = query
      if (!isIsoDate(from) || !isIsoDate(to) || to < from) throw deny(422, err.datesInvalid)
      if (countDays(from, to) > MAX_RANGE_DAYS) throw deny(422, err.rangeTooLong)
      const leaves = hr.requests()
        .filter((r) => r.status === 'approved' && r.start <= to && from <= r.end)
        .sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id)
        .map((r) => [personName(team.byId(r.personId)), strings.leave.kinds[r.kind], formatDate(r.start), formatDate(r.end), r.days])
      const balances = team.people()
        .filter((p) => !p.isArchived)
        .map((p) => ({ p, b: hr.balanceOf(p.id) }))
        .map(({ p, b }) => [personName(p), b?.accrued ?? '', b?.used ?? '', b?.planned ?? '', b?.available ?? ''])
      const dataBase64 = await toXlsx([[xs.leaveSheet, [xs.leaveColumns, ...leaves]], [xs.balanceSheet, [xs.balanceColumns, ...balances]]])
      return { fileName: `leave_${from}_${to}.xlsx`, dataBase64 }
    },
  }

  return { handlers }
}
