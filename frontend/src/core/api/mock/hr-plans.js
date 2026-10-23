// Mock модуля HR, часть «Б»: годовой график отпусков, дни рождения, свои документы. Контракт — docs/TZ-hr-people-ops.md.
// Все люди вымышленные. Данные in-memory; планы живут здесь, документы и досье читаются из хранилища hr.js (hr.store).
// Права: Me — любой активный; Team — team >= view; Hr — run на hr; Mgr — руководитель с подчинёнными-карточками.
import { ApiError } from '../client.js'
import strings from '../../../modules/hr/strings.js'
import { addDays, isIsoDate, parseIso, todayIso } from '../../dates.js'

const err = strings.errors
const COMMENT_LIMIT = 300
const BASE = '/modules/hr'

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const deny = (status, message) => new ApiError(status, message)
const overlaps = (a, b) => a.start <= b.end && b.start <= a.end

// Вымышленные планы относительно «сегодня»: у «Закупок» в декабре перегруз (подсветка), остальное разреженно
function seedPlans(today) {
  const d = (n) => addDays(today, n)
  const plan = (id, personId, from, to, comment, extra = {}) => ({
    id, personId, start: d(from), end: d(to), comment, status: 'planned', requestId: null, createdAt: `${today}T09:00:00.000Z`, ...extra,
  })
  return [
    plan(1, 11, 40, 53, 'Поездка домой', { status: 'converted', requestId: 2 }), // совпадает с согласованной заявкой Ани из hr.js
    plan(2, 11, 200, 213, 'Лето'),
    plan(3, 12, 45, 52, null),
    plan(4, 10, 60, 66, 'Короткий отпуск'),
    plan(5, 13, 80, 93, null),
    plan(6, 8, 100, 110, 'Отпуск после кампании'),
    plan(7, 15, 30, 37, null),
    plan(8, 11, 10, 14, 'Передумала', { status: 'cancelled' }),
  ]
}

// День рождения у нескольких людей рядом с «сегодня» (год 1992 високосный, чтобы 29.02 было валидно); один человек скрыт
const BIRTHDAYS = [
  { personId: 7, offset: 0 },
  { personId: 11, offset: 2 },
  { personId: 12, offset: 6 },
  { personId: 3, offset: -4 },
  { personId: 14, offset: 1, hidden: true },
]

// deps: userFromToken, accessTo, team (из createTeamHandlers), hr (результат createHrHandlers: handlers + store)
export function createPlanHandlers({ userFromToken, accessTo, team, hr }) {
  const today = todayIso()
  const plans = seedPlans(today)
  let nextId = plans.length + 1

  // демо-данные в хранилище hr.js: даты рождения и документ, видимый сотруднику
  const files = hr.store.files()
  for (const { personId, offset, hidden } of BIRTHDAYS) {
    files[personId] = { ...hr.store.fileOf(personId), birthDate: `1992-${addDays(today, offset).slice(5)}`, birthdayHidden: Boolean(hidden) }
  }
  const demoDoc = hr.store.documents().find((x) => x.id === 1)
  if (demoDoc) demoDoc.visibleToEmployee = true

  const nameOf = (p) => `${p.lastName} ${p.firstName}`

  const ctxTeam = (token) => {
    const user = userFromToken(token)
    if (!['view', 'run'].includes(accessTo(user, 'team'))) throw deny(403, err.forbidden)
    return user
  }
  const ctxHr = (token) => {
    const user = userFromToken(token)
    if (accessTo(user, 'hr') !== 'run') throw deny(403, err.forbidden)
    return user
  }
  const myPerson = (user) => {
    const p = team.personOf(user)
    if (!p) throw deny(422, err.noCard)
    return p
  }
  const parseYear = (query) => {
    const raw = query.year ?? today.slice(0, 4)
    if (!/^\d{4}$/.test(raw)) throw deny(422, err.yearInvalid)
    return Number(raw)
  }
  const inYear = (pl, year) => pl.start <= `${year}-12-31` && pl.end >= `${year}-01-01`
  const byStart = (a, b) => a.start.localeCompare(b.start) || a.id - b.id

  const planOut = ({ id, start, end, comment, status, requestId }) => ({ id, start, end, comment, status, requestId })
  const findMyPlan = (user, id) => {
    const person = myPerson(user)
    const pl = plans.find((x) => x.id === Number(id) && x.personId === person.id)
    if (!pl) throw deny(404, err.planNotFound)
    return pl
  }
  const requirePlanned = (pl) => {
    if (pl.status !== 'planned') throw deny(409, err.planNotPlanned)
  }

  const handlers = {
    // ---- Me: свои документы (только отмеченные HR) ----
    [`GET ${BASE}/me/documents`]: ({ token }) => {
      const person = team.personOf(userFromToken(token))
      if (!person) return []
      return hr.store
        .documents()
        .filter((d) => d.personId === person.id && d.visibleToEmployee === true)
        .map(({ id, category, title, fileName, sizeBytes, uploadedAt }) => ({ id, category, title, fileName, sizeBytes, uploadedAt }))
    },

    [`GET ${BASE}/me/documents/:id`]: ({ token, params }) => {
      const person = team.personOf(userFromToken(token))
      const doc = person && hr.store.documents().find((d) => d.id === Number(params.id) && d.personId === person.id && d.visibleToEmployee === true)
      if (!doc) throw deny(404, err.docNotFound)
      return { fileName: doc.fileName, mime: doc.mime, sizeBytes: doc.sizeBytes, dataBase64: doc.dataBase64 }
    },

    // ---- Me: мой план ----
    [`GET ${BASE}/me/leave/plans`]: ({ token, query }) => {
      const user = userFromToken(token)
      const year = parseYear(query)
      const person = team.personOf(user)
      if (!person) return []
      return plans.filter((pl) => pl.personId === person.id && inYear(pl, year)).sort(byStart).map(planOut)
    },

    [`POST ${BASE}/me/leave/plans`]: ({ token, body }) => {
      const person = myPerson(userFromToken(token))
      const b = isObject(body) ? body : {}
      if (!isIsoDate(b.start) || !isIsoDate(b.end) || b.end < b.start) throw deny(422, err.datesInvalid)
      if (b.start < today) throw deny(422, err.pastDates)
      if (parseIso(b.end).y > Number(today.slice(0, 4)) + 1) throw deny(422, err.planYear)
      if (b.comment !== undefined && b.comment !== null && typeof b.comment !== 'string') throw deny(422, err.invalid)
      const comment = (b.comment ?? '').trim()
      if (comment.length > COMMENT_LIMIT) throw deny(422, err.planCommentLong)
      if (plans.some((pl) => pl.personId === person.id && pl.status === 'planned' && overlaps(pl, b))) throw deny(409, err.planOverlap)
      const pl = { id: nextId++, personId: person.id, start: b.start, end: b.end, comment: comment || null, status: 'planned', requestId: null, createdAt: new Date().toISOString() }
      plans.push(pl)
      return planOut(pl)
    },

    [`POST ${BASE}/me/leave/plans/:id/cancel`]: ({ token, params }) => {
      const pl = findMyPlan(userFromToken(token), params.id)
      requirePlanned(pl)
      pl.status = 'cancelled'
      return planOut(pl)
    },

    // Заявку создаёт существующий mock-обработчик (даты в прошлом, первый отпуск, пересечения, согласующий, уведомления)
    [`POST ${BASE}/me/leave/plans/:id/request`]: async ({ token, params, body }) => {
      const pl = findMyPlan(userFromToken(token), params.id)
      requirePlanned(pl)
      const b = isObject(body) ? body : {}
      const created = await hr.handlers[`POST ${BASE}/me/leave/requests`]({
        token,
        body: { kind: b.kind ?? 'annual', start: pl.start, end: pl.end, message: b.message },
      })
      Object.assign(pl, { status: 'converted', requestId: created.id })
      return planOut(pl)
    },

    // Руководитель: планы непосредственных подчинённых (без отменённых); не руководитель — 403
    [`GET ${BASE}/me/leave/team-plan`]: ({ token, query }) => {
      const person = team.personOf(userFromToken(token))
      const subs = person ? team.people().filter((p) => p.managerId === person.id && !p.isArchived) : []
      if (subs.length === 0) throw deny(403, err.forbidden)
      const year = parseYear(query)
      const ids = new Set(subs.map((p) => p.id))
      return plans
        .filter((pl) => ids.has(pl.personId) && pl.status !== 'cancelled' && inYear(pl, year))
        .sort(byStart)
        .map((pl) => ({ personId: pl.personId, name: nameOf(team.byId(pl.personId)), start: pl.start, end: pl.end, comment: pl.comment, status: pl.status }))
    },

    // ---- Hr: график всех (без отменённых) ----
    [`GET ${BASE}/leave/plan`]: ({ token, query }) => {
      ctxHr(token)
      const year = parseYear(query)
      return plans
        .filter((pl) => pl.status !== 'cancelled' && inYear(pl, year) && team.byId(pl.personId))
        .sort(byStart)
        .map((pl) => {
          const p = team.byId(pl.personId)
          return { id: pl.id, personId: p.id, name: nameOf(p), directionId: p.directionId, start: pl.start, end: pl.end, comment: pl.comment, status: pl.status }
        })
    },

    // ---- Team: дни рождения (только день и месяц, без года и возраста) ----
    [`GET ${BASE}/birthdays`]: ({ token, query }) => {
      ctxTeam(token)
      const raw = query.month ?? today.slice(0, 7)
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) throw deny(422, err.monthInvalid)
      const month = Number(raw.slice(5))
      return team
        .people()
        .filter((p) => p.showInMap && !p.isArchived)
        .map((p) => ({ p, file: hr.store.files()[p.id] }))
        .filter(({ file }) => file?.birthDate && !file.birthdayHidden && Number(file.birthDate.slice(5, 7)) === month)
        .map(({ p, file }) => ({ personId: p.id, name: nameOf(p), directionId: p.directionId, day: Number(file.birthDate.slice(8, 10)), month }))
        .sort((a, b) => a.day - b.day || a.personId - b.personId)
    },
  }

  return { handlers }
}
