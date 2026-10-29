// Mock смены пароля и версии токена. Контракт — docs/TZ-security.md, п. 1–2.
// Токен `mock:<id>:<tv>`; `mock:<id>` без версии = tv 0 (как токены без `tv` на сервере). Несовпадение версии = 401.
import strings from '../../strings.js'
import { validateNewPassword } from '../../auth/passwordRules.js'
import { ApiError } from '../client.js'
import { data, DEMO_PASSWORD } from './data.js'
import { sharedPasswordOk } from './onboarding.js'

const err = strings.errors
const MAX_FAILS = 5
const FAIL_WINDOW_MS = 15 * 60 * 1000

export const versionOf = (userId) => data.tokenVersions[userId] ?? 0
export const issueToken = (userId) => `mock:${userId}:${versionOf(userId)}`
export const passwordOf = (user) => data.passwords[user.id] ?? DEMO_PASSWORD

// Новый пароль и закрытие всех прежних токенов пользователя
export function setPassword(userId, password) {
  data.passwords[userId] = password
  data.tokenVersions[userId] = versionOf(userId) + 1
}

export function userFromToken(token) {
  const m = /^mock:(\d+)(?::(\d+))?$/.exec(token ?? '')
  const user = m && data.users.find((u) => u.id === Number(m[1]))
  if (!user || !user.is_active || Number(m[2] ?? 0) !== versionOf(user.id)) throw new ApiError(401, err.unauthorized)
  return user
}

// deps: userFromToken, audit.log, personIdOfUser(userId) -> id карточки | null; now — для тестов окна попыток
export function createAuthHandlers({ userFromToken: auth, audit, personIdOfUser, now = Date.now }) {
  const fails = new Map() // userId -> [время неудачной попытки]

  const recentFails = (userId) => {
    const list = (fails.get(userId) ?? []).filter((t) => now() - t < FAIL_WINDOW_MS)
    fails.set(userId, list)
    return list
  }

  const handlers = {
    'POST /auth/change-password': ({ token, body }) => {
      const user = auth(token)
      const oldPassword = body?.oldPassword
      const newPassword = body?.newPassword
      if (typeof oldPassword !== 'string' || typeof newPassword !== 'string') throw new ApiError(422, err.invalid)
      if (recentFails(user.id).length >= MAX_FAILS) throw new ApiError(429, err.tooManyAttempts)
      // «Текущий пароль»: личный или (шаг «пароль» новичка) общий стартовый
      if (oldPassword !== passwordOf(user) && !sharedPasswordOk(user, oldPassword)) {
        fails.get(user.id).push(now())
        throw new ApiError(401, err.wrongOldPassword)
      }
      const problem = validateNewPassword(oldPassword, newPassword)
      if (problem) throw new ApiError(422, problem)
      if (user.must_change_password && sharedPasswordOk(user, newPassword)) throw new ApiError(422, strings.profile.settings.password.sameAsOld)
      fails.delete(user.id)
      setPassword(user.id, newPassword)
      user.must_change_password = false
      audit.log(user.id, 'core.password_change', { personId: personIdOfUser(user.id) })
      return { token: issueToken(user.id) }
    },
  }

  return { handlers }
}
