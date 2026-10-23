// Даты как строки YYYY-MM-DD, без часовых поясов. Чистые функции, без React.
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/
const pad = (n) => String(n).padStart(2, '0')

const utc = (y, m, d) => Date.UTC(y, m - 1, d)
const daysInMonth = (y, m) => new Date(utc(y, m + 1, 0)).getUTCDate() // m — 1..12; день 0 следующего месяца = последний день этого
const fromUtc = (ms) => {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function parseIso(value) {
  const m = ISO.exec(typeof value === 'string' ? value : '')
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null
  return { y, m: mo, d }
}

export const isIsoDate = (value) => parseIso(value) !== null

// Сегодня по локальному календарю (не UTC)
export function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// 2026-10-23 -> 23.10.2026
export function formatDate(iso) {
  const p = parseIso(iso)
  return p ? `${pad(p.d)}.${pad(p.m)}.${p.y}` : ''
}

export const addDays = (iso, n) => {
  const p = parseIso(iso)
  return fromUtc(utc(p.y, p.m, p.d) + n * 86400000)
}

// Календарные дни включительно
export function countDays(start, end) {
  const a = parseIso(start)
  const b = parseIso(end)
  return Math.round((utc(b.y, b.m, b.d) - utc(a.y, a.m, a.d)) / 86400000) + 1
}

// Полные месяцы от from до to; если в конце месяца дня-«якоря» нет (31.01 -> 28.02), месяц считается полным
export function fullMonths(from, to) {
  const a = parseIso(from)
  const b = parseIso(to)
  let months = (b.y - a.y) * 12 + (b.m - a.m)
  const lastDay = b.d === daysInMonth(b.y, b.m)
  if (b.d < a.d && !lastDay) months -= 1
  return Math.max(months, 0)
}

// Дата + n месяцев (день прижимается к концу месяца)
export function addMonths(iso, n) {
  const p = parseIso(iso)
  const total = p.y * 12 + (p.m - 1) + n
  const y = Math.floor(total / 12)
  const m = (total % 12) + 1
  return `${y}-${pad(m)}-${pad(Math.min(p.d, daysInMonth(y, m)))}`
}
