// Mock сводки HR над таблицей «Сотрудники»: GET /modules/hr/stats. Контракт и правила — docs/TZ-hr-analytics.md, раздел «API»
// (бэкенд — backend/app/modules/hr/stats.py). Все люди вымышленные. Только чтение хранилищ team и hr; денег, больничных и дат рождения в ответе нет.
// Права: run на hr. Охват — все неархивные карточки, включая скрытые из карты (TODO(Q-HA2)). Пол — answers.gender (TODO(Q-HA1)).
import { ApiError } from '../client.js'
import strings from '../../../modules/hr/strings.js'
import { addDays, fullMonths, parseIso, todayIso } from '../../dates.js'

const BASE = '/modules/hr'
const MIN_FOR_AVERAGE = 3
const NEWCOMER_DAYS = 90
const DISMISSED_DAYS = 90
const LEAVE_SOON_DAYS = 14
const TOP_MANAGERS = 10
const AGE_MIN = 14
const AGE_MAX = 100
const COUNTRIES = ['RU', 'AM']
const EMPLOYMENT_TYPES = ['staff', 'gph', 'ip', 'other']
const GENDERS = ['male', 'female']
const AGE_KEYS = ['under_25', '25_34', '35_44', '45_54', '55_plus']
const TENURE_KEYS = ['lt_3m', '3_12m', '1_3y', '3_5y', '5y_plus']

const nameOf = (p) => `${p.lastName} ${p.firstName}`.trim()
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length

function fullYears(born, today) {
  const b = parseIso(born)
  const t = parseIso(today)
  return t.y - b.y - (t.m < b.m || (t.m === b.m && t.d < b.d) ? 1 : 0)
}
const ageKey = (a) => (a < 25 ? 'under_25' : a < 35 ? '25_34' : a < 45 ? '35_44' : a < 55 ? '45_54' : '55_plus')
const tenureKey = (m) => (m < 3 ? 'lt_3m' : m < 12 ? '3_12m' : m < 36 ? '1_3y' : m < 60 ? '3_5y' : '5y_plus')

// Подпись — вариант поля анкеты (без учёта регистра), иначе самое частое написание (при равенстве — первое по алфавиту)
function textGroups(values, options) {
  const spellings = new Map()
  for (const v of values) {
    if (typeof v !== 'string') continue
    const text = v.split(/\s+/).filter(Boolean).join(' ')
    if (!text) continue
    const key = text.toLowerCase()
    const counter = spellings.get(key) ?? new Map()
    counter.set(text, (counter.get(text) ?? 0) + 1)
    spellings.set(key, counter)
  }
  const byOption = new Map(options.map((o) => [o.toLowerCase(), o]))
  const items = [...spellings].map(([key, counter]) => {
    const best = [...counter].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0][0]
    return { label: byOption.get(key) ?? best, count: [...counter.values()].reduce((a, b) => a + b, 0) }
  })
  items.sort((a, b) => b.count - a.count || cmp(a.label, b.label))
  return { known: items.reduce((a, i) => a + i.count, 0), items }
}

function keyed(values, order) {
  const items = order.map((key) => ({ key, count: values.filter((v) => v === key).length })).filter((i) => i.count > 0)
  return { known: items.reduce((a, i) => a + i.count, 0), items }
}

// people — все карточки team; directions — справочник; files — { [personId]: досье }; requests — заявки на отпуск;
// fields — поля анкеты (нужны options location/work_format)
export function computeStats({ people, directions, files, requests, fields, today = todayIso() }) {
  const working = people.filter((p) => !p.isArchived)
  const fileOf = (p) => files[p.id] ?? {}
  const answersOf = (p) => p.answers ?? {}
  const optionsOf = (key) => fields.find((f) => f.key === key)?.options ?? []
  const workingIds = new Set(working.map((p) => p.id))
  const byId = new Map(working.map((p) => [p.id, p]))
  const dirs = [...directions].sort((a, b) => a.sort - b.sort)

  const ages = working
    .map((p) => fileOf(p).birthDate)
    .filter(Boolean)
    .map((b) => fullYears(b, today))
    .filter((a) => a >= AGE_MIN && a <= AGE_MAX)
  const months = working
    .map((p) => fileOf(p).hiredAt)
    .filter((h) => h && h <= today)
    .map((h) => fullMonths(h, today))
  const bucketsOf = (keys, values, keyOf) => keys.map((key) => ({ key, count: values.filter((v) => keyOf(v) === key).length }))

  const newcomers = working
    .filter((p) => {
      const h = fileOf(p).hiredAt
      return h && h >= addDays(today, -NEWCOMER_DAYS) && h <= today
    })
    .sort((a, b) => cmp(fileOf(b).hiredAt, fileOf(a).hiredAt) || a.id - b.id)
  const dismissed = people.filter((p) => {
    const d = fileOf(p).dismissedAt
    return p.isArchived && d && d >= addDays(today, -DISMISSED_DAYS) && d <= today
  })
  const probation = working.filter((p) => {
    const f = fileOf(p)
    return f.probationUntil && f.probationUntil >= today && (!f.hiredAt || f.hiredAt <= today)
  })

  // отпуска: одобренные, не больничные, человек работает; у человека — самая ранняя заявка в каждом списке
  const soonUntil = addDays(today, LEAVE_SOON_DAYS)
  const now = new Map()
  const soon = new Map()
  const leaveRows = requests
    .filter((r) => r.status === 'approved' && r.kind !== 'sick' && workingIds.has(r.personId) && r.start <= soonUntil && r.end >= today)
    .sort((a, b) => cmp(a.start, b.start) || a.id - b.id)
  for (const r of leaveRows) {
    const p = byId.get(r.personId)
    const item = { personId: p.id, name: nameOf(p), directionId: p.directionId, kind: r.kind, start: r.start, end: r.end }
    if (r.start <= today && today <= r.end) {
      if (!now.has(p.id)) now.set(p.id, item)
    } else if (today < r.start && r.start <= soonUntil && !soon.has(p.id)) soon.set(p.id, item)
  }
  const byStart = (a, b) => cmp(a.start, b.start) || a.personId - b.personId

  const reports = new Map()
  for (const p of working) if (p.managerId !== null && workingIds.has(p.managerId)) reports.set(p.managerId, (reports.get(p.managerId) ?? 0) + 1)
  const top = [...reports]
    .sort((a, b) => b[1] - a[1] || cmp(nameOf(byId.get(a[0])), nameOf(byId.get(b[0]))) || a[0] - b[0])
    .slice(0, TOP_MANAGERS)
  const teams = new Set(working.map((p) => (p.team ?? '').split(/\s+/).filter(Boolean).join(' ').toLowerCase()).filter(Boolean))

  return {
    asOf: today,
    total: working.length,
    withAccount: working.filter((p) => p.userId !== null && p.userId !== undefined).length,
    hiddenFromMap: working.filter((p) => !p.showInMap).length,
    upcomingHires: working.filter((p) => fileOf(p).hiredAt > today).length,
    directions: dirs.map((d) => ({ id: d.id, count: working.filter((p) => p.directionId === d.id).length })).filter((d) => d.count > 0),
    teamsCount: teams.size,
    location: textGroups(working.map((p) => answersOf(p).location), optionsOf('location')),
    workFormat: textGroups(working.map((p) => answersOf(p).work_format), optionsOf('work_format')),
    gender: keyed(working.map((p) => answersOf(p).gender), GENDERS),
    country: keyed(working.map((p) => fileOf(p).country), COUNTRIES),
    employmentType: keyed(working.map((p) => fileOf(p).employmentType), EMPLOYMENT_TYPES),
    age: {
      known: ages.length,
      average: ages.length >= MIN_FOR_AVERAGE ? Math.round(mean(ages) * 10) / 10 : null,
      buckets: bucketsOf(AGE_KEYS, ages, ageKey),
    },
    tenure: {
      known: months.length,
      averageMonths: months.length >= MIN_FOR_AVERAGE ? Math.round(mean(months)) : null,
      buckets: bucketsOf(TENURE_KEYS, months, tenureKey),
    },
    newcomers: {
      days: NEWCOMER_DAYS,
      count: newcomers.length,
      people: newcomers.map((p) => ({ personId: p.id, name: nameOf(p), directionId: p.directionId, hiredAt: fileOf(p).hiredAt })),
    },
    dismissed: { days: DISMISSED_DAYS, count: dismissed.length },
    probation: { count: probation.length },
    leave: { soonDays: LEAVE_SOON_DAYS, now: [...now.values()].sort(byStart), soon: [...soon.values()].sort(byStart) },
    managers: {
      count: reports.size,
      avgSpan: reports.size > 0 ? Math.round(mean([...reports.values()]) * 10) / 10 : null,
      top: top.map(([id, n]) => ({ personId: id, name: nameOf(byId.get(id)), directionId: byId.get(id).directionId, reports: n })),
    },
  }
}

// Вымышленный пол для демо (у части людей не указан: 1, 2, 9, 16). Карточки team не меняются
const DEMO_GENDER = { 3: 'male', 4: 'female', 5: 'male', 6: 'female', 7: 'female', 8: 'male', 10: 'male', 11: 'female', 12: 'male', 13: 'female', 14: 'female', 15: 'male' }
// Высокосные годы: у dossier-дней рождения из hr-plans.js бывает 29.02, месяц и день не трогаем
const DEMO_BIRTH_YEARS = { 3: 1980, 7: 1988, 11: 1996, 12: 2000, 14: 1984 }

// deps: userFromToken, accessTo(user, moduleId), team (из createTeamHandlers), hr (из createHrHandlers: store.files, requests)
export function createHrStatsHandlers({ userFromToken, accessTo, team, hr }) {
  const today = todayIso()
  const files = hr.store.files()

  // Демо-данные: разные годы рождения, досье у части людей без него (1, 2, 7, 16 остаются «неуказанными»)
  for (const [id, year] of Object.entries(DEMO_BIRTH_YEARS)) {
    const f = files[id]
    if (f?.birthDate) files[id] = { ...f, birthDate: `${year}${f.birthDate.slice(4)}` }
  }
  const demoFiles = {
    4: { birthDate: '1975-03-12', hiredAt: '2019-05-06', country: 'RU', employmentType: 'staff' },
    5: { birthDate: '1999-07-30', hiredAt: addDays(today, -40), country: 'RU', employmentType: 'staff' },
    6: { birthDate: '1990-11-02', hiredAt: addDays(today, -200), country: 'RU', employmentType: 'gph' },
    8: { birthDate: '2002-01-18', hiredAt: addDays(today, -500), country: 'AM', employmentType: 'staff' },
    9: { birthDate: '1993-09-09', hiredAt: addDays(today, -1100), country: 'AM', employmentType: 'ip' },
  }
  for (const [id, patch] of Object.entries(demoFiles)) files[id] = { ...hr.store.fileOf(Number(id)), ...patch }
  if (files[13]) files[13] = { ...files[13], probationUntil: addDays(today, 15) }

  const ctxHr = (token) => {
    const user = userFromToken(token)
    if (accessTo(user, 'hr') !== 'run') throw new ApiError(403, strings.errors.forbidden)
    return user
  }

  const handlers = {
    [`GET ${BASE}/stats`]: ({ token }) => {
      ctxHr(token)
      return computeStats({
        people: team.people().map((p) => ({ ...p, answers: { ...p.answers, gender: DEMO_GENDER[p.id] } })),
        directions: team.directions(),
        files,
        requests: hr.requests(),
        fields: team.handlers['GET /modules/team/hr/fields']({ token }),
        today: todayIso(),
      })
    },
  }
  return { handlers }
}
