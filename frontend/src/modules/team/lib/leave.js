// Чистые функции вида «Отпуска» и метки «в отпуске» (без React). Даты — строки YYYY-MM-DD, см. core/dates.js.
// Запись календаря: { personId, name, directionId, kind, start, end } (GET /modules/hr/leave/calendar).
import { addDays, addMonths, countDays, parseIso } from '../../../core/dates.js'

// Первое число месяца, в котором лежит дата
export const monthStart = (iso) => `${iso.slice(0, 7)}-01`

export const monthEnd = (first) => addDays(addMonths(first, 1), -1)

export const shiftMonth = (first, n) => addMonths(first, n)

// 0 = воскресенье … 6 = суббота
export function weekday(iso) {
  const p = parseIso(iso)
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()
}

// Дни месяца: [{ iso, day, weekday, weekend }]
export function monthDays(first) {
  const total = countDays(first, monthEnd(first))
  return Array.from({ length: total }, (_, i) => {
    const iso = addDays(first, i)
    const wd = weekday(iso)
    return { iso, day: i + 1, weekday: wd, weekend: wd === 0 || wd === 6 }
  })
}

// Отрезки отпусков человека, обрезанные по границам месяца: [{ kind, start, end, col, span }]; col — номер дня месяца (с 1)
export function segmentsOf(leaves, personId, first) {
  const last = monthEnd(first)
  return leaves
    .filter((l) => l.personId === personId && l.start <= last && l.end >= first)
    .map((l) => {
      const start = l.start < first ? first : l.start
      const end = l.end > last ? last : l.end
      return { kind: l.kind, start: l.start, end: l.end, col: countDays(first, start), span: countDays(start, end) }
    })
    .sort((a, b) => a.col - b.col)
}

// Кто в отпуске в день today: { [personId]: { end } } (если отпусков несколько — с самым поздним концом)
export function awayMap(leaves, today) {
  const away = {}
  for (const l of leaves ?? []) {
    if (l.start > today || l.end < today) continue
    if (!away[l.personId] || l.end > away[l.personId].end) away[l.personId] = { end: l.end }
  }
  return away
}
