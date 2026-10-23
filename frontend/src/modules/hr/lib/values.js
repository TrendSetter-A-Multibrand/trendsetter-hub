// Чистые помощники по значениям анкеты (без React).

import { emptyOf, isEmptyValue } from '../../team/lib/profile.js'

export { isEmptyValue, emptyOf } from '../../team/lib/profile.js'

// Значения анкеты, живущие в колонках карточки, а не в answers
export const COLUMN_KEYS = { first_name: 'firstName', last_name: 'lastName', title: 'title', email: 'email' }

// Поля, которые не показываются в форме HR: manager_claim — подсказка для HR, photo — отдельный контрол
export const FORM_SKIP = ['manager_claim', 'photo']

// Значение -> текст для таблицы сравнения
export function formatValue(field, v) {
  if (isEmptyValue(v)) return ''
  if (field.kind === 'chips') return v.join(', ')
  if (field.kind === 'links') return v.map((l) => `${l.label}: ${l.url}`).join('\n')
  return String(v)
}

// Значения формы -> тело для POST/PATCH /hr/people: колонки на верхнем уровне, остальное в values
export function splitValues(fields, values) {
  const body = {}
  const rest = {}
  for (const f of fields) {
    if (FORM_SKIP.includes(f.key) || f.kind === 'photo') continue
    const v = values[f.key] ?? emptyOf(f)
    if (COLUMN_KEYS[f.key]) body[COLUMN_KEYS[f.key]] = typeof v === 'string' ? v.trim() : v
    else rest[f.key] = v
  }
  body.values = rest
  return body
}

// Карточка PersonHr -> значения формы (по переданным полям)
export function valuesOfPerson(fields, person) {
  const out = {}
  for (const f of fields) {
    if (FORM_SKIP.includes(f.key) || f.kind === 'photo') continue
    out[f.key] = COLUMN_KEYS[f.key] ? (person[COLUMN_KEYS[f.key]] ?? '') : (person.answers?.[f.key] ?? emptyOf(f))
  }
  return out
}
