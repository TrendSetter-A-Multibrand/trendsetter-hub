// Mock модуля HR: досье, отпуска, календарь, нормы. Контракт — docs/TZ-hr-dossier.md, раздел «API».
// Все люди вымышленные. Данные in-memory (у каждой фабрики своё хранилище), сбрасываются при перезагрузке страницы.
// Права: Me — любой активный сотрудник; Team — team >= view; Hr — run на hr; Resp — личное/групповое responsible на hr.
import { ApiError } from '../client.js'
import strings from '../../../modules/hr/strings.js'
import { addDays, addMonths, countDays, formatDate, fullMonths, isIsoDate, todayIso } from '../../dates.js'
import { data as hub } from './data.js'
import { base64Bytes, extensionOf } from '../../lib/files.js'
import { DOC_CATEGORIES, DOC_MAX_BYTES, DOC_MAX_COUNT, DOC_MIME, DOC_TITLE_LIMIT } from '../../../modules/hr/lib/documents.js'

const err = strings.errors
const nf = strings.notify

export const LEAVE_KINDS = ['annual', 'unpaid', 'study', 'sick', 'other']
const STATUSES = ['pending', 'approved', 'rejected', 'cancelled']
const COUNTRIES = ['RU', 'AM']
const EMPLOYMENT = ['staff', 'gph', 'ip', 'other']
const FILE_TEXT = ['legalName', 'contractNo', 'workSchedule', 'dismissalReason', 'phone', 'personalEmail', 'emergencyContact', 'notes']
const FILE_DATES = ['birthDate', 'hiredAt', 'probationUntil', 'contractDate', 'dismissedAt']
const SENSITIVE_TEXT = ['currency', 'bonusNote', 'taxId', 'socialId', 'passport', 'bankDetails']
const TEXT_LIMIT = 500
const NOTES_LIMIT = 2000
const MAX_RANGE_DAYS = 400

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const has = (obj, key) => isObject(obj) && obj[key] !== undefined
const deny = (status, message) => new ApiError(status, message)
const round2 = (x) => Math.round(x * 100) / 100
const strOrNull = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

const emptyFile = (personId) => ({
  personId, legalName: null, birthDate: null, country: null, employmentType: null, hiredAt: null, probationUntil: null,
  contractNo: null, contractDate: null, workSchedule: null, dismissedAt: null, dismissalReason: null, phone: null,
  personalEmail: null, emergencyContact: null, notes: null, birthdayHidden: false, updatedAt: null,
})
const emptySensitive = (personId) => ({
  personId, salary: null, currency: null, payDay1: null, payDay2: null, bonusNote: null, taxId: null, socialId: null,
  passport: null, bankDetails: null, updatedAt: null,
})

// ---- расчёт баланса (чистая функция) ----
// policy: { daysPerYear, accruePerMonth, firstLeaveAfterMonths }; requests: [{kind,status,days,end}]; adjustments: [{deltaDays}]
// Нет hiredAt -> null. Праздничные дни считаются как обычные (TODO(Q-D2)); нормы Армении — TODO(Q-D1).
export function computeBalance({ hiredAt, policy, requests = [], adjustments = [], today }) {
  if (!hiredAt || !policy) return null
  const months = fullMonths(hiredAt, today)
  const accrued = round2(months * policy.accruePerMonth)
  const adjust = round2(adjustments.reduce((sum, a) => sum + a.deltaDays, 0))
  const annual = requests.filter((r) => r.kind === 'annual' && r.status === 'approved')
  const used = round2(annual.filter((r) => r.end < today).reduce((sum, r) => sum + r.days, 0))
  const planned = round2(annual.filter((r) => r.end >= today).reduce((sum, r) => sum + r.days, 0))
  const availableFrom = months < policy.firstLeaveAfterMonths ? addMonths(hiredAt, policy.firstLeaveAfterMonths) : null
  return { accrued, adjust, used, planned, available: round2(accrued + adjust - used - planned), availableFrom }
}

const overlaps = (a, b) => a.start <= b.end && b.start <= a.end

function seed() {
  const today = todayIso()
  const d = (n) => addDays(today, n)
  const stamp = (n) => `${d(n)}T09:00:00.000Z`
  const policies = {
    RU: { country: 'RU', daysPerYear: 28, accruePerMonth: 2.333, firstLeaveAfterMonths: 6 },
    AM: { country: 'AM', daysPerYear: 28, accruePerMonth: 2.333, firstLeaveAfterMonths: 0 },
  }
  const file = (personId, patch) => ({ ...emptyFile(personId), updatedAt: stamp(-30), ...patch })
  const files = {
    3: file(3, { legalName: 'Громов Павел Андреевич', country: 'RU', employmentType: 'staff', hiredAt: '2020-02-17', workSchedule: 'Пятидневка, 10:00–19:00' }),
    10: file(10, { legalName: 'Кравцов Денис Сергеевич', country: 'RU', employmentType: 'staff', hiredAt: '2022-06-01', workSchedule: 'Пятидневка, 10:00–19:00' }),
    11: file(11, { legalName: 'Саркисян Ани Арамовна', country: 'AM', employmentType: 'staff', hiredAt: '2024-03-11', workSchedule: 'Гибрид, 3 дня в офисе' }),
    12: file(12, { legalName: 'Жуков Лев Игоревич', country: 'RU', employmentType: 'staff', hiredAt: '2025-02-03', workSchedule: 'Пятидневка, 10:00–19:00' }),
    13: file(13, { legalName: 'Захарова Полина Викторовна', country: 'AM', employmentType: 'staff', hiredAt: d(-75), workSchedule: 'Пятидневка, 10:00–19:00' }),
    14: file(14, { legalName: 'Фролова Ирина Олеговна', country: 'RU', employmentType: 'staff', hiredAt: '2021-01-11', workSchedule: 'Пятидневка, 09:00–18:00' }),
    15: file(15, { legalName: 'Назаров Тимур Рустамович', country: 'RU', employmentType: 'staff', hiredAt: '2023-09-18', workSchedule: 'Пятидневка, 09:00–18:00' }),
  }
  const req = (id, personId, kind, startOff, endOff, status, extra = {}) => ({
    id, personId, kind, start: d(startOff), end: d(endOff), days: endOff - startOff + 1, message: '', status,
    approverUserId: null, decidedBy: null, decidedAt: null, decisionComment: null, createdBy: null, createdAt: stamp(startOff - 20), ...extra,
  })
  const requests = [
    req(1, 11, 'annual', -120, -107, 'approved', { approverUserId: 10, decidedBy: 10, decidedAt: stamp(-150), message: 'Буду на связи в Telegram' }),
    req(2, 11, 'annual', 40, 53, 'approved', {
      approverUserId: 10, decidedBy: 10, decidedAt: stamp(-5), message: 'Отдыхаю, по срочным вопросам — к Льву Жукову',
    }),
    req(3, 12, 'study', 12, 18, 'approved', { approverUserId: 10, decidedBy: 10, decidedAt: stamp(-3), message: 'Сессия, на связи по вечерам' }),
    req(4, 13, 'unpaid', 25, 29, 'pending', { approverUserId: 10, message: 'Семейные обстоятельства' }),
  ]
  const adjustments = [{ id: 1, personId: 11, deltaDays: 7, reason: 'Начальный остаток на дату внедрения', createdBy: null, createdAt: stamp(-200) }]
  // демо-документы: крошечные валидные файлы (txt и png 1x1), без реального содержимого
  const b64 = (text) => btoa(text)
  const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const doc = (id, personId, category, title, fileName, dataBase64, uploadOff, visibleToEmployee = false) => {
    const ext = extensionOf(fileName)
    return {
      id, personId, category, title, fileName, mime: DOC_MIME[ext], dataBase64, sizeBytes: base64Bytes(dataBase64),
      uploadedBy: hub.users.find((u) => u.id === 13)?.full_name ?? null, uploadedAt: stamp(uploadOff), visibleToEmployee,
    }
  }
  const documents = [
    doc(1, 11, 'contract', 'Трудовой договор', 'contract-demo.txt', b64('Demo file. No real content.'), -60, true),
    doc(2, 11, 'id_doc', 'Скан паспорта', 'passport-demo.png', PNG_1X1, -45),
    doc(3, 12, 'order', 'Приказ о приёме', 'order-demo.txt', b64('Demo file. No real content.'), -20),
  ]
  const sensitive = {
    10: { ...emptySensitive(10), salary: 250000, currency: 'RUB', payDay1: 5, payDay2: 20, passport: 'QQ 777', updatedAt: stamp(-30) },
    12: { ...emptySensitive(12), salary: 420000, currency: 'AMD', payDay1: 10, updatedAt: stamp(-30) },
  }
  return { policies, files, sensitive, requests, adjustments, documents, nextId: { request: 5, adjustment: 2, document: 4 } }
}

// deps: userFromToken, accessTo(user, moduleId), isResponsible(user) — responsible на hr,
// team — { people(), personOf(user), byId(id) } из createTeamHandlers, notify(userIds, notification),
// audit — { log(userId, action, { personId, details }) } журнала (необязателен: без него записи не пишутся)
export function createHrHandlers({ userFromToken, accessTo, isResponsible, team, notify, audit = { log: () => {} } }) {
  const db = seed()
  const sensitiveListeners = []
  const BASE = '/modules/hr'

  // ---- права ----
  const ctxHr = (token) => {
    const user = userFromToken(token)
    if (accessTo(user, 'hr') !== 'run') throw deny(403, err.forbidden)
    return user
  }
  const ctxResp = (token) => {
    const user = ctxHr(token)
    if (!isResponsible(user)) throw deny(403, err.forbidden)
    return user
  }
  const hrUsers = () => hub.users.filter((u) => u.is_active && accessTo(u, 'hr') === 'run')

  // ---- люди ----
  const personName = (p) => `${p.lastName} ${p.firstName}`
  const userName = (id) => hub.users.find((u) => u.id === id)?.full_name ?? null
  const findPerson = (id) => {
    const p = team.byId(id)
    if (!p) throw deny(404, err.personNotFound)
    return p
  }
  const docOut = ({ id, category, title, fileName, mime, sizeBytes, uploadedBy, uploadedAt, visibleToEmployee }) => ({
    id, category, title, fileName, mime, sizeBytes, uploadedBy, uploadedAt, visibleToEmployee,
  })
  const findDoc = (id) => {
    const doc = db.documents.find((d) => d.id === Number(id))
    if (!doc) throw deny(404, err.docNotFound)
    return doc
  }
  const fileOf = (personId) => db.files[personId] ?? emptyFile(personId)
  const policyOf = (personId) => db.policies[fileOf(personId).country ?? 'RU']
  const policyOut = (p) => ({ country: p.country, daysPerYear: p.daysPerYear, accruePerMonth: p.accruePerMonth, firstLeaveAfterMonths: p.firstLeaveAfterMonths })

  // approver = пользователь, привязанный к карточке руководителя; нет аккаунта -> null (согласует HR)
  const approverOf = (person) => {
    const manager = person.managerId === null ? null : team.byId(person.managerId)
    const user = manager?.userId ? hub.users.find((u) => u.id === manager.userId && u.is_active) : null
    return { user: user ?? null, manager }
  }

  // Коллеги: неархивные с тем же руководителем, сам руководитель, все HR; только с аккаунтом, без повторов и без excluded
  function colleagueUserIds(person, excluded) {
    const ids = new Set()
    const add = (userId) => userId && ids.add(userId)
    team.people().forEach((p) => {
      if (!p.isArchived && p.id !== person.id && p.managerId !== null && p.managerId === person.managerId) add(p.userId)
    })
    if (person.managerId !== null) add(team.byId(person.managerId)?.userId)
    hrUsers().forEach((u) => add(u.id))
    ;[person.userId, ...excluded].forEach((id) => ids.delete(id))
    return [...ids]
  }

  const balanceOf = (personId) => {
    const file = fileOf(personId)
    return computeBalance({
      hiredAt: file.hiredAt,
      policy: policyOf(personId),
      requests: db.requests.filter((r) => r.personId === personId),
      adjustments: db.adjustments.filter((a) => a.personId === personId),
      today: todayIso(),
    })
  }

  const requestOut = (r) => ({
    id: r.id, personId: r.personId, personName: personName(team.byId(r.personId)), kind: r.kind, start: r.start, end: r.end, days: r.days,
    message: r.message, status: r.status, decidedBy: userName(r.decidedBy), decidedAt: r.decidedAt, decisionComment: r.decisionComment,
    createdAt: r.createdAt, awaitingHr: r.status === 'pending' && r.approverUserId === null,
  })
  const requestsOf = (personId) =>
    db.requests.filter((r) => r.personId === personId).sort((a, b) => b.start.localeCompare(a.start) || b.id - a.id).map(requestOut)
  const adjustmentOut = (a) => ({ id: a.id, personId: a.personId, deltaDays: a.deltaDays, reason: a.reason, createdBy: userName(a.createdBy), createdAt: a.createdAt })
  const leaveOf = (personId) => ({
    policy: policyOut(policyOf(personId)),
    balance: balanceOf(personId),
    requests: requestsOf(personId),
    adjustments: db.adjustments.filter((a) => a.personId === personId).sort((a, b) => b.id - a.id).map(adjustmentOut),
  })

  const findRequest = (id) => {
    const r = db.requests.find((x) => x.id === Number(id))
    if (!r) throw deny(404, err.requestNotFound)
    return r
  }

  // ---- заявки ----
  function parseRequest(body, { allowPast }) {
    const b = isObject(body) ? body : {}
    if (!LEAVE_KINDS.includes(b.kind)) throw deny(422, err.kindInvalid)
    if (!isIsoDate(b.start) || !isIsoDate(b.end) || b.end < b.start) throw deny(422, err.datesInvalid)
    if (!allowPast && b.start < todayIso()) throw deny(422, err.pastDates)
    const message = typeof b.message === 'string' ? b.message.trim() : ''
    if (message.length > TEXT_LIMIT) throw deny(422, err.messageTooLong)
    return { kind: b.kind, start: b.start, end: b.end, message }
  }

  function checkOverlap(personId, range) {
    const clash = db.requests.some((r) => r.personId === personId && ['pending', 'approved'].includes(r.status) && overlaps(r, range))
    if (clash) throw deny(409, err.overlap)
  }

  function checkFirstLeave(personId, { kind, start }) {
    const balance = balanceOf(personId)
    if (kind === 'annual' && balance?.availableFrom && start < balance.availableFrom) {
      throw deny(422, err.firstLeaveFrom(formatDate(balance.availableFrom)))
    }
  }

  function addRequest(person, parsed, fields) {
    const r = {
      id: db.nextId.request++, personId: person.id, ...parsed, days: countDays(parsed.start, parsed.end), status: 'pending',
      approverUserId: null, decidedBy: null, decidedAt: null, decisionComment: null, createdBy: null, createdAt: new Date().toISOString(), ...fields,
    }
    db.requests.push(r)
    return r
  }

  // Больничные коллегам не рассылаются
  function notifyAbsence(r, excluded = []) {
    if (r.kind === 'sick') return
    const person = team.byId(r.personId)
    const name = personName(person)
    notify(colleagueUserIds(person, excluded), {
      kind: 'leave_approved', title: nf.absentTitle(name), body: nf.absentBody(name, formatDate(r.start), formatDate(r.end), r.message), link: '/modules/team',
    })
  }

  function notifyCancel(r, excluded = []) {
    if (r.kind === 'sick') return
    const person = team.byId(r.personId)
    const name = personName(person)
    notify(colleagueUserIds(person, excluded), {
      kind: 'leave_cancelled', title: nf.cancelTitle(name), body: nf.cancelBody(name, formatDate(r.start), formatDate(r.end)), link: '/modules/team',
    })
  }

  const requireMyPerson = (user) => {
    const p = team.personOf(user)
    if (!p) throw deny(422, err.noCard)
    return p
  }

  const handlers = {
    // ---- Me ----
    [`GET ${BASE}/me/leave`]: ({ token }) => {
      const user = userFromToken(token)
      const person = team.personOf(user)
      if (!person) return { person: null, policy: null, balance: null, requests: [], approver: null }
      const { user: approver, manager } = approverOf(person)
      return {
        person: { id: person.id, name: personName(person) },
        policy: policyOut(policyOf(person.id)),
        balance: balanceOf(person.id),
        requests: requestsOf(person.id),
        approver: approver && manager ? { name: personName(manager) } : null,
      }
    },

    // TODO(Q-D6): в замороженном контракте нет эндпоинта «мои данные» (только чтение, без денег). Mock отдаёт безопасное подмножество досье.
    [`GET ${BASE}/me/file`]: ({ token }) => {
      const user = userFromToken(token)
      const person = team.personOf(user)
      if (!person) return { person: null, file: null }
      const f = fileOf(person.id)
      return {
        person: { id: person.id, name: personName(person) },
        file: { legalName: f.legalName, hiredAt: f.hiredAt, country: f.country, workSchedule: f.workSchedule },
      }
    },

    // Q-D5: сотрудник видит свой оклад. «Своя» карточка строго по userId (без поиска по почте); только 4 поля.
    [`GET ${BASE}/me/compensation`]: ({ token }) => {
      const user = userFromToken(token)
      const person = team.people().find((p) => p.userId === user.id)
      if (!person) return { person: null, compensation: null }
      const row = db.sensitive[person.id]
      return {
        person: { id: person.id, name: personName(person) },
        compensation: row ? { salary: row.salary, currency: row.currency, payDay1: row.payDay1, payDay2: row.payDay2 } : null,
      }
    },

    [`POST ${BASE}/me/leave/requests`]: ({ token, body }) => {
      const user = userFromToken(token)
      const person = requireMyPerson(user)
      const parsed = parseRequest(body, { allowPast: false })
      checkFirstLeave(person.id, parsed)
      checkOverlap(person.id, parsed)
      const { user: approver } = approverOf(person)
      const r = addRequest(person, parsed, { approverUserId: approver?.id ?? null, createdBy: user.id })
      const text = { kind: 'leave_request', title: nf.requestTitle, body: nf.requestBody(personName(person), formatDate(r.start), formatDate(r.end)) }
      if (approver) notify([approver.id], { ...text, link: '/profile?section=approvals' })
      else notify(hrUsers().map((u) => u.id).filter((id) => id !== user.id), { ...text, link: '/modules/hr' })
      return requestOut(r)
    },

    [`POST ${BASE}/me/leave/requests/:id/cancel`]: ({ token, params }) => {
      const user = userFromToken(token)
      const person = requireMyPerson(user)
      const r = findRequest(params.id)
      if (r.personId !== person.id) throw deny(404, err.requestNotFound)
      const wasApproved = r.status === 'approved'
      if (!(r.status === 'pending' || (wasApproved && r.start >= todayIso()))) throw deny(409, err.cantCancel)
      r.status = 'cancelled'
      if (wasApproved) notifyCancel(r)
      return requestOut(r)
    },

    [`GET ${BASE}/me/approvals`]: ({ token }) => {
      const user = userFromToken(token)
      const pending = db.requests
        .filter((r) => r.approverUserId === user.id && r.status === 'pending')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id)
      const decided = db.requests
        .filter((r) => r.decidedBy === user.id && r.status !== 'pending')
        .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? '') || b.id - a.id)
        .slice(0, 20)
      return [...pending, ...decided].map(requestOut)
    },

    [`POST ${BASE}/leave/requests/:id/decision`]: ({ token, params, body }) => {
      const user = userFromToken(token)
      const r = findRequest(params.id)
      if (r.approverUserId !== user.id && accessTo(user, 'hr') !== 'run') throw deny(403, err.forbidden)
      if (r.status !== 'pending') throw deny(409, err.notPending)
      if (typeof body?.approve !== 'boolean') throw deny(422, err.invalid)
      const comment = typeof body.comment === 'string' ? body.comment.trim() : ''
      if (!body.approve && !comment) throw deny(422, err.commentRequired)
      if (comment.length > TEXT_LIMIT) throw deny(422, err.commentRequired)
      const person = team.byId(r.personId)
      Object.assign(r, { status: body.approve ? 'approved' : 'rejected', decidedBy: user.id, decidedAt: new Date().toISOString(), decisionComment: comment || null })
      const from = formatDate(r.start)
      const to = formatDate(r.end)
      const own = person.userId ? [person.userId] : []
      if (body.approve) {
        notifyAbsence(r, [user.id])
        notify(own, { kind: 'leave_decision', title: nf.approvedTitle, body: nf.approvedBody(from, to), link: '/profile?section=leave' })
      } else {
        notify(own, { kind: 'leave_decision', title: nf.rejectedTitle, body: nf.rejectedBody(from, to, comment), link: '/profile?section=leave' })
      }
      return requestOut(r)
    },

    // HR снимает любую pending/approved заявку (в т.ч. прошедшую); баланс пересчитывается сам
    [`POST ${BASE}/leave/requests/:id/cancel`]: ({ token, params }) => {
      const user = ctxHr(token)
      const r = findRequest(params.id)
      if (!['pending', 'approved'].includes(r.status)) throw deny(409, err.cantCancel)
      const person = team.byId(r.personId)
      const wasApproved = r.status === 'approved'
      r.status = 'cancelled'
      if (wasApproved && r.start >= todayIso()) notifyCancel(r, [user.id])
      if (person.userId && person.userId !== user.id) {
        notify([person.userId], {
          kind: 'leave_cancelled_by_hr', title: nf.cancelledByHrTitle, body: nf.cancelledByHrBody(formatDate(r.start), formatDate(r.end)), link: '/profile?section=leave',
        })
      }
      return requestOut(r)
    },

    // ---- Team ----
    [`GET ${BASE}/leave/calendar`]: ({ token, query }) => {
      const user = userFromToken(token)
      if (!['view', 'run'].includes(accessTo(user, 'team'))) throw deny(403, err.forbidden)
      const { from, to } = query
      if (!isIsoDate(from) || !isIsoDate(to) || to < from) throw deny(422, err.datesInvalid)
      if (countDays(from, to) > MAX_RANGE_DAYS) throw deny(422, err.rangeTooLong)
      return db.requests
        .filter((r) => r.status === 'approved' && r.kind !== 'sick' && overlaps(r, { start: from, end: to }))
        .map((r) => ({ r, p: team.byId(r.personId) }))
        .filter(({ p }) => p && p.showInMap && !p.isArchived)
        .sort((a, b) => a.r.start.localeCompare(b.r.start) || a.r.id - b.r.id)
        .map(({ r, p }) => ({ personId: p.id, name: personName(p), directionId: p.directionId, kind: r.kind, start: r.start, end: r.end }))
    },

    // ---- Hr ----
    [`GET ${BASE}/people/:id/file`]: ({ token, params }) => {
      const user = ctxHr(token)
      const person = findPerson(params.id)
      return { file: fileOf(person.id), leave: leaveOf(person.id), canSeeSensitive: isResponsible(user) }
    },

    [`PATCH ${BASE}/people/:id/file`]: ({ token, params, body }) => {
      const user = ctxHr(token)
      const person = findPerson(params.id)
      const b = isObject(body) ? body : {}
      const next = { ...fileOf(person.id) }
      for (const key of FILE_TEXT) {
        if (!has(b, key)) continue
        if (b[key] !== null && typeof b[key] !== 'string') throw deny(422, err.fieldInvalid(key))
        const v = strOrNull(b[key])
        if (v && v.length > (key === 'notes' ? NOTES_LIMIT : TEXT_LIMIT)) throw deny(422, err.fieldInvalid(key))
        next[key] = v
      }
      for (const key of FILE_DATES) {
        if (!has(b, key)) continue
        if (b[key] !== null && b[key] !== '' && !isIsoDate(b[key])) throw deny(422, err.fieldInvalid(key))
        next[key] = b[key] || null
      }
      if (has(b, 'country')) {
        if (b.country !== null && !COUNTRIES.includes(b.country)) throw deny(422, err.fieldInvalid('country'))
        next.country = b.country
      }
      if (has(b, 'employmentType')) {
        if (b.employmentType !== null && !EMPLOYMENT.includes(b.employmentType)) throw deny(422, err.fieldInvalid('employmentType'))
        next.employmentType = b.employmentType
      }
      if (has(b, 'birthdayHidden')) {
        if (typeof b.birthdayHidden !== 'boolean') throw deny(422, err.fieldInvalid('birthdayHidden'))
        next.birthdayHidden = b.birthdayHidden
      }
      next.updatedAt = new Date().toISOString()
      db.files[person.id] = next
      return { file: next, leave: leaveOf(person.id), canSeeSensitive: isResponsible(user) }
    },

    [`GET ${BASE}/people/:id/sensitive`]: ({ token, params }) => {
      const user = ctxResp(token)
      const person = findPerson(params.id)
      audit.log(user.id, 'hr.sensitive_view', { personId: person.id })
      return db.sensitive[person.id] ?? emptySensitive(person.id)
    },

    [`PATCH ${BASE}/people/:id/sensitive`]: ({ token, params, body }) => {
      const user = ctxResp(token)
      const person = findPerson(params.id)
      const b = isObject(body) ? body : {}
      const next = { ...(db.sensitive[person.id] ?? emptySensitive(person.id)) }
      for (const key of SENSITIVE_TEXT) {
        if (!has(b, key)) continue
        if (b[key] !== null && typeof b[key] !== 'string') throw deny(422, err.fieldInvalid(key))
        const v = strOrNull(b[key])
        if (v && v.length > TEXT_LIMIT) throw deny(422, err.fieldInvalid(key))
        next[key] = v
      }
      if (has(b, 'salary')) {
        const ok = typeof b.salary === 'number' && Number.isFinite(b.salary) && b.salary >= 0 && b.salary < 1e10
        if (b.salary !== null && !ok) throw deny(422, err.fieldInvalid('salary'))
        next.salary = b.salary
      }
      for (const key of ['payDay1', 'payDay2']) {
        if (!has(b, key)) continue
        if (b[key] !== null && !(Number.isInteger(b[key]) && b[key] >= 1 && b[key] <= 31)) throw deny(422, err.fieldInvalid(key))
        next[key] = b[key]
      }
      next.updatedAt = new Date().toISOString()
      const before = db.sensitive[person.id] ?? emptySensitive(person.id)
      db.sensitive[person.id] = next
      // в журнал — только имена изменённых полей, без значений
      const changed = Object.keys(next).filter((key) => key !== 'updatedAt' && next[key] !== before[key])
      audit.log(user.id, 'hr.sensitive_update', { personId: person.id, details: { fields: changed } })
      if (next.salary !== before.salary || next.currency !== before.currency) {
        sensitiveListeners.forEach((fn) => fn({ person, before, after: next, actor: user }))
      }
      return next
    },

    // ---- документы сотрудника (только Resp) ----
    [`GET ${BASE}/people/:id/documents`]: ({ token, params }) => {
      const user = ctxResp(token)
      const person = findPerson(params.id)
      audit.log(user.id, 'hr.documents_list', { personId: person.id })
      return db.documents.filter((d) => d.personId === person.id).map(docOut)
    },

    [`POST ${BASE}/people/:id/documents`]: ({ token, params, body }) => {
      const user = ctxResp(token)
      const person = findPerson(params.id)
      const b = isObject(body) ? body : {}
      if (!DOC_CATEGORIES.includes(b.category)) throw deny(422, err.docCategory)
      const title = strOrNull(b.title)
      if (!title || title.length > DOC_TITLE_LIMIT) throw deny(422, err.docTitle)
      const fileName = strOrNull(b.fileName)
      const ext = fileName ? extensionOf(fileName) : ''
      if (!fileName || fileName.length > 255 || !DOC_MIME[ext]) throw deny(422, err.docExt)
      const size = base64Bytes(b.dataBase64)
      if (size === null || size === 0) throw deny(422, err.docData)
      if (size > DOC_MAX_BYTES) throw deny(422, err.docSize)
      if (db.documents.filter((d) => d.personId === person.id).length >= DOC_MAX_COUNT) throw deny(409, err.docLimit)
      if (has(b, 'visibleToEmployee') && typeof b.visibleToEmployee !== 'boolean') throw deny(422, err.invalid)
      const doc = {
        id: db.nextId.document++, personId: person.id, category: b.category, title, fileName, mime: DOC_MIME[ext],
        dataBase64: b.dataBase64, sizeBytes: size, uploadedBy: user.full_name, uploadedAt: new Date().toISOString(),
        visibleToEmployee: b.visibleToEmployee === true,
      }
      db.documents.push(doc)
      return docOut(doc)
    },

    [`GET ${BASE}/documents/:id`]: ({ token, params }) => {
      ctxResp(token)
      const doc = findDoc(params.id)
      return { fileName: doc.fileName, mime: doc.mime, sizeBytes: doc.sizeBytes, dataBase64: doc.dataBase64 }
    },

    // Правка метаданных: «Показывать сотруднику», название, категория (Resp)
    [`PATCH ${BASE}/documents/:id`]: ({ token, params, body }) => {
      ctxResp(token)
      const doc = findDoc(params.id)
      const b = isObject(body) ? body : {}
      if (has(b, 'visibleToEmployee') && typeof b.visibleToEmployee !== 'boolean') throw deny(422, err.invalid)
      if (has(b, 'category') && !DOC_CATEGORIES.includes(b.category)) throw deny(422, err.docCategory)
      const title = has(b, 'title') ? strOrNull(b.title) : doc.title
      if (!title || title.length > DOC_TITLE_LIMIT) throw deny(422, err.docTitle)
      if (has(b, 'visibleToEmployee')) doc.visibleToEmployee = b.visibleToEmployee
      if (has(b, 'category')) doc.category = b.category
      doc.title = title
      return docOut(doc)
    },

    [`POST ${BASE}/documents/:id/delete`]: ({ token, params }) => {
      ctxResp(token)
      const doc = findDoc(params.id)
      db.documents = db.documents.filter((d) => d !== doc)
      return { ok: true }
    },

    [`POST ${BASE}/people/:id/leave/requests`]: ({ token, params, body }) => {
      const user = ctxHr(token)
      const person = findPerson(params.id)
      const parsed = parseRequest(body, { allowPast: true })
      if (has(body, 'status') && body.status !== 'approved') throw deny(422, err.statusInvalid)
      checkOverlap(person.id, parsed)
      const approved = body?.status === 'approved'
      const { user: approver } = approverOf(person)
      const r = addRequest(person, parsed, {
        approverUserId: approver?.id ?? null,
        createdBy: user.id,
        ...(approved ? { status: 'approved', decidedBy: user.id, decidedAt: new Date().toISOString() } : {}),
      })
      if (approved && r.start >= todayIso()) notifyAbsence(r, [user.id])
      return requestOut(r)
    },

    [`POST ${BASE}/people/:id/leave/adjustments`]: ({ token, params, body }) => {
      const user = ctxHr(token)
      const person = findPerson(params.id)
      const delta = body?.deltaDays
      const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
      const deltaOk = typeof delta === 'number' && Number.isFinite(delta) && delta !== 0 && Math.abs(delta) <= 365
      if (!deltaOk || !reason || reason.length > TEXT_LIMIT) throw deny(422, err.adjustInvalid)
      const a = { id: db.nextId.adjustment++, personId: person.id, deltaDays: round2(delta), reason, createdBy: user.id, createdAt: new Date().toISOString() }
      db.adjustments.push(a)
      return adjustmentOut(a)
    },

    [`GET ${BASE}/leave/requests`]: ({ token, query }) => {
      ctxHr(token)
      const status = query.status ?? 'all'
      if (status !== 'all' && !STATUSES.includes(status)) throw deny(422, err.statusInvalid)
      const personId = query.personId === undefined ? null : Number(query.personId)
      if (personId !== null && !Number.isInteger(personId)) throw deny(422, err.invalid)
      return db.requests
        .filter((r) => (status === 'all' || r.status === status) && (personId === null || r.personId === personId))
        .sort((a, b) => b.start.localeCompare(a.start) || b.id - a.id)
        .map(requestOut)
    },

    [`GET ${BASE}/leave/policies`]: ({ token }) => {
      ctxHr(token)
      return COUNTRIES.map((c) => policyOut(db.policies[c]))
    },

    [`PATCH ${BASE}/leave/policies/:country`]: ({ token, params, body }) => {
      ctxResp(token)
      const policy = db.policies[params.country]
      if (!policy) throw deny(404, err.policyNotFound)
      const b = isObject(body) ? body : {}
      const next = { ...policy }
      const range = (key, min, max, integer = false) => {
        if (!has(b, key)) return
        const v = b[key]
        if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) throw deny(422, err.fieldInvalid(key))
        next[key] = v
      }
      range('daysPerYear', 0, 60)
      range('accruePerMonth', 0, 10)
      range('firstLeaveAfterMonths', 0, 24, true)
      Object.assign(policy, next)
      return policyOut(policy)
    },
  }

  // Бейдж модуля hr в /core/me: заявки на отпуск, ждущие HR (у руководителя нет аккаунта). Только для HR (run).
  const moduleBadges = (user) => {
    if (accessTo(user, 'hr') !== 'run') return {}
    const count = db.requests.filter((r) => r.status === 'pending' && r.approverUserId === null).length
    return count > 0 ? { hr: count } : {}
  }

  // Доступ к хранилищу для mock плана отпусков/дней рождения/своих документов (hr-plans.js): геттеры, т.к. db.documents и db.files[id] заменяются
  const store = { documents: () => db.documents, files: () => db.files, fileOf }

  // balanceOf/requests — для mock экспорта (hrOps.js): живые объекты, не изменять
  // onSensitivePatched(fn) — fn({ person, before, after, actor }) после PATCH денег, если изменились salary или currency (автоистория оклада)
  return { handlers, moduleBadges, store, balanceOf, requests: () => db.requests, onSensitivePatched: (fn) => sensitiveListeners.push(fn) }
}
