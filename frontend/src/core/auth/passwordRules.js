import strings from '../strings.js'

const p = strings.profile.settings.password
export const NEW_PASSWORD_MIN = 10
export const NEW_PASSWORD_MAX = 128

// Правила смены пароля (docs/TZ-security.md): длина по Unicode-символам. Общие для формы и mock. null — всё хорошо.
export function validateNewPassword(oldPassword, newPassword) {
  const length = [...(newPassword ?? '')].length
  if (length < NEW_PASSWORD_MIN) return p.tooShort
  if (length > NEW_PASSWORD_MAX) return p.tooLong
  if (newPassword === oldPassword) return p.sameAsOld
  return null
}

// Проверка формы на клиенте: порядок как в форме (старый, новый, повтор). null — всё хорошо.
export function validatePasswordForm({ oldPassword, newPassword, repeat }) {
  if (!oldPassword) return p.oldRequired
  const rule = validateNewPassword(oldPassword, newPassword)
  if (rule) return rule
  if (newPassword !== repeat) return p.mismatch
  return null
}
