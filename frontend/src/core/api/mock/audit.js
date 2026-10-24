// Mock журнала HR: стор записей и GET /modules/hr/audit. Контракт — docs/TZ-security.md, п. 3.
// Пишут сюда другие mock-фабрики (необязательная зависимость audit.log). Значения полей в журнал не попадают: details — белый список ключей.
import { ApiError } from '../client.js'
import strings from '../../../modules/hr/strings.js'
import { addDays, isIsoDate, todayIso } from '../../dates.js'
import { data as hub } from './data.js'

const err = strings.errors
const DETAILS_WHITELIST = ['person_id', 'document_id', 'category', 'kind', 'rows', 'sensitive', 'fields', 'count', 'template_id', 'year']
const LIMIT_MAX = 200
const LIMIT_DEFAULT = 50

const pickDetails = (details) =>
  Object.fromEntries(Object.entries(details ?? {}).filter(([key, value]) => DETAILS_WHITELIST.includes(key) && value !== undefined))

// deps: userFromToken, canView(user) — responsible на hr или администратор, byId(personId) -> карточка | undefined
export function createAuditStore({ userFromToken, canView, byId }) {
  const entries = []
  let nextId = 1

  const userName = (id) => hub.users.find((u) => u.id === id)?.full_name ?? null
  const personName = (id) => {
    const p = id === null || id === undefined ? null : byId(id)
    return p ? `${p.lastName} ${p.firstName}` : null
  }

  // at — ISO-время (по умолчанию «сейчас»); details фильтруется белым списком
  function log(userId, action, { personId = null, details = {}, at = new Date().toISOString() } = {}) {
    entries.push({ id: nextId++, at, userId, action, personId, details: pickDetails({ ...details, ...(personId === null ? {} : { person_id: personId }) }) })
  }

  const out = (e) => ({
    id: e.id, at: e.at, userName: userName(e.userId), action: e.action, label: strings.audit.labels[e.action] ?? e.action,
    personId: e.personId, personName: personName(e.personId), details: e.details,
  })

  function intParam(raw, fallback, min, max) {
    if (raw === undefined) return fallback
    const n = Number(raw)
    if (raw === '' || !Number.isInteger(n) || n < min || n > max) throw new ApiError(422, err.invalid)
    return n
  }

  const handlers = {
    'GET /modules/hr/audit': ({ token, query }) => {
      const user = userFromToken(token)
      if (!canView(user)) throw new ApiError(403, err.forbidden)
      const { personId, action, from, to } = query
      if ((from !== undefined && !isIsoDate(from)) || (to !== undefined && !isIsoDate(to)) || (from && to && to < from)) {
        throw new ApiError(422, err.datesInvalid)
      }
      if (personId !== undefined && !Number.isInteger(Number(personId))) throw new ApiError(422, err.invalid)
      const limit = intParam(query.limit, LIMIT_DEFAULT, 1, LIMIT_MAX)
      const offset = intParam(query.offset, 0, 0, Number.MAX_SAFE_INTEGER)
      // action — одно действие или список через запятую (до 40, формат `префикс.имя`), точное совпадение
      const actions = action === undefined ? null : action.split(',')
      if (actions && (actions.length > 40 || !actions.every((a) => /^[a-z_]+\.[a-z_]+$/.test(a)))) throw new ApiError(422, err.invalid)
      const found = entries
        .filter((e) => personId === undefined || e.personId === Number(personId))
        .filter((e) => !actions || actions.includes(e.action))
        .filter((e) => from === undefined || e.at.slice(0, 10) >= from)
        .filter((e) => to === undefined || e.at.slice(0, 10) <= to)
        .sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id)
      const result = { items: found.slice(offset, offset + limit).map(out), total: found.length }
      // просмотр без фильтров и со стартовой страницы пишем в журнал (иначе листание раздувало бы его)
      if (personId === undefined && action === undefined && from === undefined && to === undefined && offset === 0) log(user.id, 'hr.audit_view')
      return result
    },
  }

  // Несколько записей за прошлые дни, чтобы вкладка в демо не была пустой
  const today = todayIso()
  const seedAt = (n, time) => `${addDays(today, n)}T${time}.000Z`
  log(13, 'hr.sensitive_view', { personId: 10, at: seedAt(-3, '08:12:00') })
  log(13, 'hr.documents_list', { personId: 10, at: seedAt(-3, '08:13:00') })
  log(13, 'hr.sensitive_update', { personId: 12, details: { fields: ['salary', 'currency'] }, at: seedAt(-2, '10:40:00') })
  log(1, 'hr.export', { details: { kind: 'people', rows: 14 }, at: seedAt(-1, '15:05:00') })
  log(1, 'core.user_permission_set', { at: seedAt(-1, '15:30:00') })

  return { handlers, log }
}
