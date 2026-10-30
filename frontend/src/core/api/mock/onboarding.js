// Mock онбординга нового сотрудника (контракт — docs/TZ-onboarding.md, PR 1). Не граница безопасности: пароли сравниваются обычным ===.
// Допустимые расхождения с сервером: домен самосоздания — example.com (демо-пользователи живут на нём); team.js может привязать
// карточку сразу при отправке анкеты и подставляет значения карточки новичку (D5 в mock не повторяется);
// нет лимита неудачных входов на почту и предохранителя D4.
import strings from '../../strings.js'
import { ApiError } from '../client.js'
import { data } from './data.js'

const err = strings.errors

export const MOCK_DOMAIN = 'example.com'
export const ONBOARDING_TTL_DAYS = 14
export const SELF_REGISTER_DAILY_LIMIT = 20
export const SHARED_PASSWORD_MIN_LEN = 12
export const HR_LEVELS = ['employee', 'viewer', 'superuser']
const DAY_MS = 24 * 60 * 60 * 1000
const LOCAL_PART_RE = /^[a-z0-9._-]{1,64}$/

// Маршруты без проверки онбординга (вход и выход)
const ALWAYS_OPEN = ['POST /auth/login', 'POST /auth/demo-login', 'GET /auth/demo-users', 'POST /auth/logout']
// Шаг «пароль»: только свой профиль и смена пароля
const PASSWORD_STEP = ['GET /core/me', 'POST /auth/change-password']
// Шаг «анкета»: плюс пять маршрутов анкеты
const PROFILE_STEP = [
  ...PASSWORD_STEP,
  'GET /modules/team/me',
  'GET /modules/team/fields',
  'POST /modules/team/me/submission',
  'PATCH /modules/team/me/submission',
  'POST /modules/team/me/submission/cancel',
]

// D2: ровно одна «@», локальная часть [a-z0-9._-]{1,64}, домен в точности MOCK_DOMAIN (поддомены не проходят)
export function selfRegisterEmailOk(emailKey) {
  if (emailKey.length > 254 || emailKey.split('@').length !== 2) return false
  const [local, domain] = emailKey.split('@')
  return domain === MOCK_DOMAIN && LOCAL_PART_RE.test(local)
}

// Общий пароль применим к учётке: активна, на онбординге, пароль ещё не менялся, срок не истёк
export function sharedEligible(user, now = Date.now()) {
  return Boolean(user.is_active && user.onboarding && user.must_change_password && user.onboarding_expires_at && Date.parse(user.onboarding_expires_at) > now)
}

export const sharedPasswordSet = () => Boolean(data.onboarding.password)

export function sharedPasswordOk(user, password, now = Date.now()) {
  return sharedEligible(user, now) && sharedPasswordSet() && password === data.onboarding.password
}

export const registeredToday = (now = Date.now()) => data.onboarding.registeredAt.filter((t) => now - t < DAY_MS).length

// Самосоздание: вызывать, когда почта свободна, проходит D2 и общий пароль верен. Суточный лимит — 429.
export function selfRegister({ emailKey, audit, now = Date.now() }) {
  if (registeredToday(now) >= SELF_REGISTER_DAILY_LIMIT) throw new ApiError(429, err.onboardingLimit)
  const user = {
    id: data.nextId.user++,
    email: emailKey,
    full_name: emailKey.split('@')[0].slice(0, 120),
    access_level: null,
    department_ids: [],
    is_active: true,
    must_change_password: true,
    onboarding: true,
    onboarding_expires_at: new Date(now + ONBOARDING_TTL_DAYS * DAY_MS).toISOString(),
  }
  data.users.push(user)
  data.passwords[user.id] = crypto.randomUUID() // личный пароль неизвестен никому до смены
  data.onboarding.registeredAt.push(now)
  audit.log(user.id, 'core.onboarding_self_register')
  return user
}

// Шлюз: оборачивает ВСЕ обработчики. Пока у пользователя есть шаг онбординга, разрешено только то, что в списках выше.
export function withOnboardingGate(handlers, userFromToken) {
  const gated = {}
  for (const [route, handler] of Object.entries(handlers)) {
    if (ALWAYS_OPEN.includes(route)) {
      gated[route] = handler
      continue
    }
    gated[route] = (request) => {
      let user = null
      try {
        user = userFromToken(request.token)
      } catch {
        return handler(request) // нет токена или токен плохой: ответит исходный обработчик (401)
      }
      const allowed = user?.must_change_password ? PASSWORD_STEP : user?.onboarding ? PROFILE_STEP : null
      if (allowed && !allowed.includes(route)) throw new ApiError(403, err.onboardingRequired)
      return handler(request)
    }
  }
  return gated
}
