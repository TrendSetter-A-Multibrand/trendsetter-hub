// Mock модуля «Производственный календарь» (демо-режим): тот же контракт, права и коды, что у бэкенда (docs/TZ-holidays.md, раздел «Эндпойнты»).
// Журнал в mock не ведётся. Демо-данные заданы относительно года now() (текущий и следующий).
import { ApiError } from '../client.js'
import { canSeeData } from '../../access.js'
import { addDays, countDays, formatDate, parseIso } from '../../dates.js'

const COUNTRY_IDS = ['RU', 'AM']
const KINDS = ['holiday', 'day_off', 'workday', 'short']
// Зеркало бэкенда и modules/holidays/lib/holidays.js: ядро не импортирует modules/holidays
const MIN_DATE = '2000-01-01'
const MAX_DATE = '2100-12-31'
const MAX_WRITE_DAYS = 31
const MAX_READ_DAYS = 400
const NAME_LIMIT = 100
const MAX_BAD_DATES = 5

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isWeekend = (iso) => {
  const p = parseIso(iso)
  const day = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()
  return day === 0 || day === 6
}
const pad = (n) => String(n).padStart(2, '0')

// Вымышленные/несверенные данные, только для демонстрации: [месяц, день, название] и диапазоны [месяц, день, месяц, день, название]
const DEMO_RU = {
  ranges: [[1, 1, 1, 8, 'Новогодние каникулы']],
  days: [[2, 23, 'День защитника Отечества'], [3, 8, 'Международный женский день'], [5, 1, 'Праздник Весны и Труда'], [5, 9, 'День Победы'], [6, 12, 'День России'], [11, 4, 'День народного единства']],
}
const DEMO_AM = {
  ranges: [[1, 1, 1, 2, 'Новый год']],
  days: [[1, 6, 'Рождество'], [3, 8, 'Женский день'], [4, 24, 'День памяти'], [5, 9, 'День Победы'], [5, 28, 'День Республики'], [7, 5, 'День Конституции'], [9, 21, 'День независимости'], [12, 31, 'Канун Нового года']],
}

// deps: userFromToken(token) — 401 без токена; accessTo(user, moduleId); isEditor(user); errors — тексты ошибок модуля
// (strings.errors из реестра: ядро не импортирует modules/holidays); now — для тестов
export function createHolidaysHandlers({ userFromToken, accessTo, isEditor, errors: err, now = () => new Date() }) {
  const rows = new Map() // `${country}|${date}` -> { country, date, kind, name }
  const put = (country, date, kind, name = null) => rows.set(`${country}|${date}`, { country, date, kind, name })

  // ---- демо-данные ----
  const year = now().getFullYear()
  for (const y of [year, year + 1]) {
    const iso = (m, d) => `${y}-${pad(m)}-${pad(d)}`
    for (const [country, demo] of [['RU', DEMO_RU], ['AM', DEMO_AM]]) {
      for (const [m1, d1, m2, d2, name] of demo.ranges) {
        for (let i = 0; i < countDays(iso(m1, d1), iso(m2, d2)); i += 1) put(country, addDays(iso(m1, d1), i), 'holiday', name)
      }
      for (const [m, d, name] of demo.days) put(country, iso(m, d), 'holiday', name)
    }
    put('RU', iso(1, 9), 'day_off') // перенос выходного на будний день
    put('RU', iso(3, 7), 'short') // накануне 8 марта
    let saturday = iso(2, 10)
    while (new Date(`${saturday}T00:00:00Z`).getUTCDay() !== 6) saturday = addDays(saturday, 1)
    put('RU', saturday, 'workday') // рабочая суббота (перенос)
  }

  const reader = (token) => {
    const user = userFromToken(token)
    if (!(isEditor(user) || canSeeData(accessTo(user, 'holidays')))) throw new ApiError(403, err.forbidden)
    return user
  }
  const editorOf = (token) => {
    const user = userFromToken(token)
    if (!isEditor(user)) throw new ApiError(403, err.forbidden)
    return user
  }

  const dateOf = (value) => {
    if (typeof value !== 'string' || !parseIso(value)) throw new ApiError(422, err.invalid)
    return value
  }
  const checkBounds = (start, end) => {
    if (start < MIN_DATE || end < MIN_DATE || start > MAX_DATE || end > MAX_DATE) throw new ApiError(422, err.datesOutOfRange)
  }
  const inRange = (start, end, country) =>
    [...rows.values()].filter((r) => r.date >= start && r.date <= end && (!country || r.country === country)).sort((a, b) => a.country.localeCompare(b.country) || a.date.localeCompare(b.date))
  const checkWriteRange = (start, end) => {
    checkBounds(start, end)
    if (end < start) throw new ApiError(422, err.rangeOrder)
    if (countDays(start, end) > MAX_WRITE_DAYS) throw new ApiError(422, err.rangeTooLong)
  }
  const rangeBody = (body, allowed) => {
    if (!isObject(body) || Object.keys(body).some((k) => !allowed.includes(k))) throw new ApiError(422, err.invalid)
    if (!COUNTRY_IDS.includes(body.country)) throw new ApiError(422, err.invalid)
    return { country: body.country, start: dateOf(body.start), end: dateOf(body.end) }
  }

  const handlers = {
    'GET /modules/holidays/days': ({ token, query }) => {
      reader(token)
      const start = dateOf(query.start)
      const end = dateOf(query.end)
      checkBounds(start, end)
      if (end < start) throw new ApiError(422, err.rangeOrder)
      if (countDays(start, end) - 1 > MAX_READ_DAYS) throw new ApiError(422, err.periodTooLong)
      return { start, end, days: inRange(start, end) }
    },

    'POST /modules/holidays/days': ({ token, body }) => {
      editorOf(token)
      const { country, start, end } = rangeBody(body, ['country', 'start', 'end', 'kind', 'name'])
      if (!KINDS.includes(body.kind)) throw new ApiError(422, err.invalid)
      if (body.name != null && typeof body.name !== 'string') throw new ApiError(422, err.invalid)
      const name = (body.name ?? '').trim() || null
      if (name !== null && name.length > NAME_LIMIT) throw new ApiError(422, err.invalid)
      checkWriteRange(start, end)
      if (body.kind === 'holiday' && name === null) throw new ApiError(422, err.nameRequired)
      const dates = Array.from({ length: countDays(start, end) }, (_, i) => addDays(start, i))
      if (body.kind === 'workday') {
        const bad = dates.filter((iso) => !isWeekend(iso))
        if (bad.length) throw new ApiError(422, `${err.workdayWeekend}: ${bad.slice(0, MAX_BAD_DATES).map(formatDate).join(', ')}`)
      }
      for (const iso of dates) put(country, iso, body.kind, name)
      return { days: inRange(start, end, country) }
    },

    'POST /modules/holidays/days/delete': ({ token, body }) => {
      editorOf(token)
      const { country, start, end } = rangeBody(body, ['country', 'start', 'end'])
      checkWriteRange(start, end)
      const found = inRange(start, end, country)
      for (const r of found) rows.delete(`${r.country}|${r.date}`)
      return { count: found.length }
    },
  }

  return { handlers }
}
