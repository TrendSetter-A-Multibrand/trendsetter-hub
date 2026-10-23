// Заполненность карточки сотрудника (без React).
import { COLUMN_KEYS, isEmptyValue } from './values.js'

export const PHOTO_LABEL = 'Фото'

// Цвет тега по проценту: >=90 зелёный, 50..89 жёлтый, <50 красный
export const levelOf = (percent) => (percent >= 90 ? 'success' : percent >= 50 ? 'warning' : 'error')

// fields — все поля анкеты (GET /hr/fields); person — PersonHr.
// Учитываются активные обязательные поля (кроме manager_claim и photo) плюс фото.
// -> { percent: целое 0..100, missing: [подписи незаполненных] }
export function completeness(fields, person) {
  const items = fields
    .filter((f) => f.active && f.required && f.key !== 'manager_claim' && f.kind !== 'photo' && f.key !== 'photo')
    .map((f) => {
      const v = COLUMN_KEYS[f.key] ? person[COLUMN_KEYS[f.key]] : person.answers?.[f.key]
      return { label: f.label, filled: !isEmptyValue(typeof v === 'string' ? v.trim() : v) }
    })
  items.push({ label: PHOTO_LABEL, filled: Boolean(person.hasPhoto) })
  const filled = items.filter((i) => i.filled).length
  return { percent: Math.round((filled / items.length) * 100), missing: items.filter((i) => !i.filled).map((i) => i.label) }
}
