// Поля формы досье (HrFile) и «Деньги и документы» (HrSensitive) + чистые функции черновика и патча.
// Контракт — docs/TZ-hr-dossier.md, раздел «API». Пустое значение на сервере = null.
import { isIsoDate, parseIso } from '../../../core/dates.js'
import strings from '../strings.js'

const d = strings.dossier
const m = strings.money
const RU_DATE = /^(\d{2})\.(\d{2})\.(\d{4})$/

const options = (labels) => Object.entries(labels).map(([value, label]) => ({ value, label }))

export const FILE_FIELDS = [
  { key: 'legalName', kind: 'text', wide: true },
  { key: 'birthDate', kind: 'date' },
  { key: 'country', kind: 'select', options: options(strings.myData.countries) },
  { key: 'employmentType', kind: 'select', options: options(d.employmentTypes) },
  { key: 'hiredAt', kind: 'date' },
  { key: 'probationUntil', kind: 'date' },
  { key: 'contractNo', kind: 'text' },
  { key: 'contractDate', kind: 'date' },
  { key: 'workSchedule', kind: 'text', wide: true },
  { key: 'dismissedAt', kind: 'date', hint: d.dismissedHint },
  { key: 'dismissalReason', kind: 'text' },
  { key: 'phone', kind: 'text' },
  { key: 'personalEmail', kind: 'text' },
  { key: 'emergencyContact', kind: 'text', wide: true },
  { key: 'notes', kind: 'textarea', wide: true },
].map((f) => ({ ...f, label: d.fields[f.key] }))

export const MONEY_FIELDS = [
  { key: 'salary', kind: 'number', min: 0, max: 9999999999, precision: 2 },
  { key: 'currency', kind: 'select', options: ['RUB', 'AMD', 'USD', 'EUR'].map((c) => ({ value: c, label: c })) },
  { key: 'payDay1', kind: 'number', min: 1, max: 31, precision: 0 },
  { key: 'payDay2', kind: 'number', min: 1, max: 31, precision: 0 },
  { key: 'bonusNote', kind: 'textarea', wide: true },
  { key: 'taxId', kind: 'text' },
  { key: 'socialId', kind: 'text' },
  { key: 'passport', kind: 'text', wide: true },
  { key: 'bankDetails', kind: 'textarea', wide: true },
].map((f) => ({ ...f, label: m.fields[f.key] }))

// ДД.ММ.ГГГГ -> YYYY-MM-DD; не дата -> null
export function parseRuDate(text) {
  const match = RU_DATE.exec(String(text ?? '').trim())
  if (!match) return null
  const iso = `${match[3]}-${match[2]}-${match[1]}`
  return parseIso(iso) ? iso : null
}

const isText = (f) => f.kind === 'text' || f.kind === 'textarea'

// Черновик формы: строки для текстовых полей, остальное как есть (null = пусто)
export function buildDraft(fields, source) {
  return Object.fromEntries(fields.map((f) => [f.key, isText(f) ? (source?.[f.key] ?? '') : (source?.[f.key] ?? null)]))
}

// Изменённые поля: { patch, invalid } — invalid: ключи дат, введённых не по формату (в черновике хранится сырой текст)
export function buildPatch(fields, draft, source) {
  const patch = {}
  const invalid = []
  for (const f of fields) {
    let value = draft[f.key]
    if (isText(f)) value = String(value ?? '').trim() || null
    if (f.kind === 'date' && value !== null && !isIsoDate(value)) {
      invalid.push(f.key)
      continue
    }
    if (value !== (source?.[f.key] ?? null)) patch[f.key] = value
  }
  return { patch, invalid }
}
