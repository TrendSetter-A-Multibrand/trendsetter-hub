import strings from '../strings.js'
import { ACCESS_LEVELS } from '../access.js'

const v = strings.admin.validation

// TODO(Q-D): ограничение корпоративного домена почты не решено — пока проверяется только формат.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CODE_RE = /^[a-z][a-z0-9_]{1,31}$/

export const isValidEmail = (email) => EMAIL_RE.test((email ?? '').trim())

// Все функции возвращают null (ок) или текст ошибки из strings.
export function validateDepartmentName(name, existing, selfId) {
  const value = (name ?? '').trim()
  if (!value) return v.nameEmpty
  if (value.length > 64) return v.nameTooLong
  const lower = value.toLowerCase()
  const duplicate = existing.some((d) => d.id !== selfId && d.name.trim().toLowerCase() === lower)
  return duplicate ? v.nameDuplicate : null
}

export function validateDepartmentCode(code, existing) {
  const value = code ?? ''
  if (!CODE_RE.test(value)) return v.codeInvalid
  return existing.some((d) => d.code === value) ? v.codeDuplicate : null
}

const isValidPassword = (p) => (p ?? '').length >= 8 && new TextEncoder().encode(p).length <= 72

export const validatePassword = (password) => (isValidPassword(password) ? null : v.passwordInvalid)

export function validateUserForm({ email, full_name, access_level, password }, existingUsers) {
  if (!isValidEmail(email)) return v.emailInvalid
  const lower = email.trim().toLowerCase()
  if (existingUsers.some((u) => u.email.toLowerCase() === lower)) return v.emailDuplicate
  if (!(full_name ?? '').trim()) return v.fullNameEmpty
  if (!ACCESS_LEVELS.includes(access_level)) return v.levelInvalid
  return validatePassword(password)
}

export const validationMessages = v
