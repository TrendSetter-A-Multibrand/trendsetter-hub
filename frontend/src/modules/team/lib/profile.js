// Чистые помощники анкеты (без React): проверка обязательности, сборка тела запроса, текст значений.
import strings from '../strings.js'

const s = strings.form
const HTTP_URL = /^https?:\/\/\S+$/i

export const isEmptyValue = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)

// Пустое значение нужного типа (для очистки поля при PATCH)
export const emptyOf = (field) => (field.kind === 'chips' || field.kind === 'links' ? [] : '')

export const isSafeUrl = (url) => HTTP_URL.test(String(url ?? '').trim())

const fieldsOf = (fields, skip) => fields.filter((f) => f.active && !skip.includes(f.key))

// Проверка анкеты сотрудника -> { key: сообщение }. Фото обязательно всегда (ТЗ, решение 8), остальное — по полю required.
export function validateProfile(fields, values, { skip = [], hasPhoto = false } = {}) {
  const errors = {}
  for (const f of fieldsOf(fields, skip)) {
    if (f.kind === 'photo') {
      if (!hasPhoto) errors[f.key] = s.photoRequired
      continue
    }
    const v = values[f.key]
    const filled = f.kind === 'links' ? (v ?? []).filter((l) => l.label?.trim() || l.url?.trim()) : v
    if (f.required && (typeof filled === 'string' ? !filled.trim() : isEmptyValue(filled))) errors[f.key] = s.required
    else if (f.kind === 'links' && filled.some((l) => !isSafeUrl(l.url))) errors[f.key] = s.linkInvalid
  }
  return errors
}

// Значения формы -> values для POST/PATCH /me/submission (без фото; пустые строки ссылок отбрасываются)
export function buildValues(fields, values, skip = []) {
  const out = {}
  for (const f of fieldsOf(fields, skip)) {
    if (f.kind === 'photo') continue
    const v = values[f.key]
    if (f.kind === 'links') out[f.key] = (v ?? []).filter((l) => l.label?.trim() || l.url?.trim()).map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
    else if (f.kind === 'chips') out[f.key] = (v ?? []).map((c) => String(c).trim()).filter(Boolean)
    else out[f.key] = typeof v === 'string' ? v.trim() : (v ?? '')
  }
  return out
}
