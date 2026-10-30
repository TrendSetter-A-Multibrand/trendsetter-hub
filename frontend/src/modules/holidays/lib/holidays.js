// Чистые функции модуля «Производственный календарь». Без React; дата — строка YYYY-MM-DD.
// Бэкенд хранит только исключения (строки holidays_days); тип дня, сетка и «периоды отдыха» считаются здесь.
import { canSeeData } from '../../../core/access.js'
import { addDays, countDays, formatDate, parseIso } from '../../../core/dates.js'
import strings from '../strings.js'

// Порядок — как у часов на главной; первая страна — по умолчанию в модалке и разделе
export const COUNTRIES = [
  { id: 'AM', timezone: 'Asia/Yerevan' },
  { id: 'RU', timezone: 'Europe/Moscow' },
]
export const KINDS = ['holiday', 'day_off', 'workday', 'short']

const MAX_RANGE_DAYS = 31
const MIN_DATE = '2000-01-01'
const MAX_DATE = '2100-12-31'
const MAX_BAD_DATES = 5
const REST_TYPES = ['holiday', 'day_off', 'weekend']

// Зеркала бэкенда (modules/holidays/service.py): читатель — view/run; редактор — «Ответственный» или администратор
export const canReadHolidays = (me) => canSeeData(me?.module_access?.holidays)
export const isHolidaysEditor = (me) => me?.module_responsible?.holidays === true || me?.can_manage_users === true

// TODO(Q-HC1): выходные — сб и вс для обеих стран; шестидневка (часть организаций Армении) не учитывается
export function isWeekend(iso) {
  const p = parseIso(iso)
  const day = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()
  return day === 0 || day === 6
}

// Эффективный тип дня: строка есть — её kind; иначе сб/вс — weekend, иначе work
export const dayType = (iso, row) => row?.kind ?? (isWeekend(iso) ? 'weekend' : 'work')

// Нерабочий день: holiday, day_off, weekend (workday и short — рабочие)
export const isRest = (type) => REST_TYPES.includes(type)

// Строки сервера -> { AM: Map<iso, row>, RU: Map<iso, row> }
export function indexDays(days) {
  const index = Object.fromEntries(COUNTRIES.map((c) => [c.id, new Map()]))
  for (const row of days ?? []) index[row.country]?.set(row.date, row)
  return index
}

// Сегодняшняя дата в часовом поясе страны
export const todayIn = (timezone, now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)

// Ближайшие периоды отдыха от today на horizon дней вперёд: отрезки подряд идущих нерабочих дней (с примыкающими сб/вс),
// в которых есть хотя бы один holiday или day_off; не больше limit. Отрезок, начавшийся до today, начинается с today (now: true).
export function restPeriods(rowsByDate, today, { horizon = 365, limit = 3 } = {}) {
  const periods = []
  let current = null
  const close = () => {
    if (current?.marked) {
      periods.push({ start: current.start, end: current.end, days: current.days, names: current.names, now: current.start === today })
    }
    current = null
  }
  for (let i = 0; i <= horizon && periods.length < limit; i += 1) {
    const iso = addDays(today, i)
    const row = rowsByDate.get(iso)
    const type = dayType(iso, row)
    if (!isRest(type)) {
      close()
      continue
    }
    if (!current) current = { start: iso, end: iso, days: 0, names: [], marked: false }
    current.end = iso
    current.days += 1
    if (type !== 'weekend') current.marked = true
    if (row?.name && !current.names.includes(row.name)) current.names.push(row.name)
  }
  if (periods.length < limit) close()
  return periods
}

// Недели месяца (пн — первый): ячейка { iso } или null; month — 1..12
export function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const lead = (first.getUTCDay() + 6) % 7
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const pad = (n) => String(n).padStart(2, '0')
  const cells = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: count }, (_, i) => ({ iso: `${year}-${pad(month)}-${pad(i + 1)}` })),
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7))
}

// Подряд идущие дни одной страны с одинаковыми kind и name -> { country, start, end, kind, name }
export function groupRanges(rows) {
  const sorted = [...(rows ?? [])].sort((a, b) => a.country.localeCompare(b.country) || a.date.localeCompare(b.date))
  const ranges = []
  for (const row of sorted) {
    const last = ranges[ranges.length - 1]
    if (last && last.country === row.country && last.kind === row.kind && last.name === row.name && addDays(last.end, 1) === row.date) {
      last.end = row.date
    } else {
      ranges.push({ country: row.country, start: row.date, end: row.date, kind: row.kind, name: row.name })
    }
  }
  return ranges
}

// 2026-12-31 -> '31 дек'
export function formatShort(iso) {
  const p = parseIso(iso)
  return `${p.d} ${strings.monthsShort[p.m - 1]}`
}

// '1–11 янв' (один месяц), '31 дек – 11 янв' или '5 мая' (один день)
export function formatPeriod(start, end) {
  if (start === end) return formatShort(start)
  const a = parseIso(start)
  const b = parseIso(end)
  if (a.y === b.y && a.m === b.m) return `${a.d}–${formatShort(end)}`
  return `${formatShort(start)} – ${formatShort(end)}`
}

// '01.01–08.01' или '01.01' (список в календаре)
export const formatRange = (start, end) => (start === end ? formatDate(start).slice(0, 5) : `${formatDate(start).slice(0, 5)}–${formatDate(end).slice(0, 5)}`)

// Зеркало серверной проверки записи: текст первой ошибки или null
export function validateRange({ start, end, kind, name }) {
  const e = strings.errors
  if (!parseIso(start) || !parseIso(end)) return e.datesRequired
  if (start < MIN_DATE || end > MAX_DATE) return e.datesOutOfRange
  if (end < start) return e.rangeOrder
  if (countDays(start, end) > MAX_RANGE_DAYS) return e.rangeTooLong
  if (kind === 'holiday' && !(name ?? '').trim()) return e.nameRequired
  if (kind === 'workday') {
    const bad = Array.from({ length: countDays(start, end) }, (_, i) => addDays(start, i)).filter((iso) => !isWeekend(iso))
    if (bad.length) return `${e.workdayWeekend}: ${bad.slice(0, MAX_BAD_DATES).map(formatDate).join(', ')}`
  }
  return null
}
