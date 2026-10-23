// Чистые функции годового графика отпусков (без React). Даты — строки YYYY-MM-DD, см. core/dates.js.
// План: { id, personId, name, directionId, start, end, comment, status } (GET /modules/hr/leave/plan?year=).
import { addDays, addMonths, countDays } from '../../../core/dates.js'

// Подсветка перегруза: доля людей направления, у которых в месяце есть плановый период.
// TODO(Q-P1): порог настроить после пробного года.
export const OVERLOAD_THRESHOLD = 0.3

const pad = (n) => String(n).padStart(2, '0')

export const yearStart = (year) => `${year}-01-01`
export const yearEnd = (year) => `${year}-12-31`
export const monthFirst = (year, month) => `${year}-${pad(month)}-01` // month 1..12
export const monthLast = (year, month) => addDays(addMonths(monthFirst(year, month), 1), -1)

const overlaps = (a, b) => a.start <= b.end && b.start <= a.end

// Положение отрезка на дорожке года в процентах (обрезается по границам года); вне года -> null
export function barPosition(start, end, year) {
  const first = yearStart(year)
  const last = yearEnd(year)
  if (!overlaps({ start, end }, { start: first, end: last })) return null
  const total = countDays(first, last)
  const from = start < first ? first : start
  const to = end > last ? last : end
  return { left: ((countDays(first, from) - 1) / total) * 100, width: (countDays(from, to) / total) * 100 }
}

// Границы месяцев на дорожке года: [{ month 1..12, left, width }] в процентах
export function monthColumns(year) {
  return Array.from({ length: 12 }, (_, i) => barPosition(monthFirst(year, i + 1), monthLast(year, i + 1), year)).map((pos, i) => ({
    month: i + 1,
    ...pos,
  }))
}

// Нагрузка по направлениям и месяцам: [{ direction, size, months: [{ count, ratio, over }] }].
// people — карточки HR ({ id, directionId, isArchived }); size — неархивные люди направления; направления без людей опускаются.
export function monthLoad(plans, people, directions, year) {
  const active = people.filter((p) => !p.isArchived)
  return directions
    .map((direction) => {
      const members = new Set(active.filter((p) => p.directionId === direction.id).map((p) => p.id))
      const months = Array.from({ length: 12 }, (_, i) => {
        const range = { start: monthFirst(year, i + 1), end: monthLast(year, i + 1) }
        const busy = new Set(plans.filter((pl) => members.has(pl.personId) && overlaps(pl, range)).map((pl) => pl.personId))
        const ratio = members.size === 0 ? 0 : busy.size / members.size
        return { count: busy.size, ratio, over: members.size > 0 && ratio >= OVERLOAD_THRESHOLD }
      })
      return { direction, size: members.size, months }
    })
    .filter((row) => row.size > 0)
}

// Строки таймлайна: [{ direction, rows: [{ person, plans }] }]; фильтр по направлению и подстроке имени
export function planRows(plans, people, directions, { query = '', directionId = null } = {}) {
  const q = query.trim().toLowerCase()
  return directions
    .filter((d) => !directionId || d.id === directionId)
    .map((direction) => ({
      direction,
      rows: people
        .filter((p) => !p.isArchived && p.directionId === direction.id && (!q || p.name.toLowerCase().includes(q)))
        .map((person) => ({ person, plans: plans.filter((pl) => pl.personId === person.id).sort((a, b) => a.start.localeCompare(b.start)) })),
    }))
    .filter((g) => g.rows.length > 0)
}
