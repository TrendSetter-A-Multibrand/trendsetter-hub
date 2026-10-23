// Чистые функции дней рождения в виде «Отпуска» (без React). Только день и месяц, без года и возраста.
// Запись API: { personId, name, directionId, day, month } (GET /modules/hr/birthdays?month=YYYY-MM).
import { addDays, countDays, isIsoDate } from '../../../core/dates.js'

export const UPCOMING_DAYS = 7

const pad = (n) => String(n).padStart(2, '0')

// 'YYYY-MM' даты
export const monthKey = (iso) => iso.slice(0, 7)

// День рождения в месяце: { [personId]: day }
export function dayByPerson(items) {
  return Object.fromEntries((items ?? []).map((b) => [b.personId, b.day]))
}

// Ближайшие дни рождения: от today (включительно) на days дней вперёд.
// entries: [{ month: 'YYYY-MM', items }] — ответы API за нужные месяцы (границу месяца может пересечь окно).
// Результат: [{ personId, name, date, inDays }] по дате, затем по имени.
export function upcomingBirthdays(entries, today, days = UPCOMING_DAYS) {
  const last = addDays(today, days)
  const seen = new Set()
  const out = []
  for (const { month, items } of entries) {
    for (const b of items ?? []) {
      const date = `${month}-${pad(b.day)}`
      if (!isIsoDate(date) || date < today || date > last) continue
      const key = `${b.personId}|${date}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ personId: b.personId, name: b.name, date, inDays: countDays(today, date) - 1 })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'ru'))
}
