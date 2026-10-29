import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

// client.js -> session.js работает с sessionStorage — в Node его нет
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

// config.js читает import.meta.env (есть только в Vite): для сквозного сценария через настоящие handlers подменяем его заглушкой
const hooks = `export async function resolve(specifier, context, next) {
  if (specifier.endsWith('/config.js')) return { url: 'data:text/javascript,export const API_URL = "";export const DEMO_MODE = true', shortCircuit: true }
  return next(specifier, context)
}`
register(`data:text/javascript,${encodeURIComponent(hooks)}`)

const { ApiError } = await import('../client.js')
const { data } = await import('./data.js')
const { createMockTransport } = await import('./transport.js')
const { withOnboardingGate, selfRegister, selfRegisterEmailOk, sharedPasswordOk, SELF_REGISTER_DAILY_LIMIT } = await import('./onboarding.js')
const { handlers } = await import('./handlers.js')

const SHARED = 'Start-demo-2026'
const transport = createMockTransport(handlers)
const call = (token, method, path, body) => transport({ method, path, body, token })
const rejects = (promise, status) => assert.rejects(promise, (e) => e instanceof ApiError && e.status === status)
const login = (email, password) => call(undefined, 'POST', '/auth/login', { email, password })
const userOf = (email) => data.users.find((u) => u.email === email)

const reset = () => {
  data.users = data.users.filter((u) => !u.onboarding && !u.email.startsWith('nb-'))
  data.onboarding.password = SHARED
  data.onboarding.registeredAt = []
}

const audit = { log: () => {} }

test('selfRegisterEmailOk: домен в точности example.com, без +, ASCII, длины', () => {
  assert.equal(selfRegisterEmailOk('ivan@example.com'), true)
  assert.equal(selfRegisterEmailOk('a.b_c-d@example.com'), true)
  assert.equal(selfRegisterEmailOk('ivan@other.com'), false)
  assert.equal(selfRegisterEmailOk('ivan@x.example.com'), false)
  assert.equal(selfRegisterEmailOk('a+b@example.com'), false)
  assert.equal(selfRegisterEmailOk('иван@example.com'), false)
  assert.equal(selfRegisterEmailOk(`${'a'.repeat(65)}@example.com`), false)
  assert.equal(selfRegisterEmailOk('a@b@example.com'), false)
  assert.equal(selfRegisterEmailOk('noat'), false)
})

test('вход: обычный пользователь не затронут, общий пароль для него не работает', async () => {
  reset()
  const ok = await login('ani@example.com', 'demo')
  assert.match(ok.token, /^mock:3:/)
  await rejects(login('ani@example.com', SHARED), 401)
  const me = await call(ok.token, 'GET', '/core/me')
  assert.equal(me.onboarding, false)
  assert.equal(me.must_change_password, false)
  assert.notEqual(me.module_access.purchasing, 'none')
  assert.ok((await call(ok.token, 'GET', '/modules/team/map')).people.length > 0)
})

test('самосоздание: отказы — обычный 401, учётка не создаётся', async () => {
  reset()
  const before = data.users.length
  await rejects(login('nb-x@other.com', SHARED), 401) // чужой домен
  await rejects(login('nb-x@sub.example.com', SHARED), 401) // поддомен
  await rejects(login('nb+x@example.com', SHARED), 401)
  await rejects(login('nb-x@example.com', 'wrong'), 401) // неверный общий пароль
  data.onboarding.password = null // общий пароль очищен
  await rejects(login('nb-x@example.com', SHARED), 401)
  assert.equal(data.users.length, before)
})

test('самосоздание: учётка без уровня, флаги, срок 14 дней; повторный вход общим паролем; существующая почта', async () => {
  reset()
  const { token } = await login('Nb-First@Example.com', SHARED)
  const user = userOf('nb-first@example.com')
  assert.equal(user.access_level, null)
  assert.deepEqual(user.department_ids, [])
  assert.equal(user.onboarding, true)
  assert.equal(user.must_change_password, true)
  const days = (Date.parse(user.onboarding_expires_at) - Date.now()) / 86400000
  assert.ok(days > 13.9 && days <= 14)
  const me = await call(token, 'GET', '/core/me')
  assert.equal(me.must_change_password, true)
  assert.equal(me.onboarding, true)
  assert.ok(Object.values(me.module_access).every((a) => a === 'none'))
  assert.deepEqual(me.module_badges, {})
  assert.equal(me.unread_notifications, 0)
  assert.equal(me.can_manage_users, false)
  await login('nb-first@example.com', SHARED) // повторный вход до смены пароля
  assert.equal(data.users.filter((u) => u.email === 'nb-first@example.com').length, 1)
  await rejects(login('nb-first@example.com', 'demo'), 401) // личный пароль неизвестен
})

test('суточный лимит самосозданий: 429, старые записи не считаются', async () => {
  reset()
  const now = Date.now()
  data.onboarding.registeredAt = Array.from({ length: SELF_REGISTER_DAILY_LIMIT }, () => now)
  await rejects(login('nb-limit@example.com', SHARED), 429)
  assert.equal(userOf('nb-limit@example.com'), undefined)
  data.onboarding.registeredAt = data.onboarding.registeredAt.map(() => now - 25 * 3600 * 1000)
  await login('nb-limit@example.com', SHARED)
  assert.ok(userOf('nb-limit@example.com'))
})

test('sharedPasswordOk: только пока шаг «пароль» и срок не истёк', () => {
  reset()
  const user = selfRegister({ emailKey: 'nb-shared@example.com', audit })
  assert.equal(sharedPasswordOk(user, SHARED), true)
  assert.equal(sharedPasswordOk(user, 'other'), false)
  assert.equal(sharedPasswordOk(user, SHARED, Date.parse(user.onboarding_expires_at) + 1), false)
  user.must_change_password = false
  assert.equal(sharedPasswordOk(user, SHARED), false)
})

test('шлюз: пропуски по шагам', async () => {
  const calls = []
  const fake = Object.fromEntries(
    [
      'POST /auth/login', 'POST /auth/demo-login', 'GET /auth/demo-users', 'POST /auth/logout', 'GET /core/me', 'POST /auth/change-password',
      'GET /modules/team/me', 'GET /modules/team/fields', 'POST /modules/team/me/submission', 'PATCH /modules/team/me/submission',
      'POST /modules/team/me/submission/cancel', 'GET /modules/team/map', 'GET /core/notifications', 'GET /admin/users',
    ].map((route) => [route, () => (calls.push(route), 'ok')]),
  )
  const users = { 'password-step': { must_change_password: true, onboarding: true }, 'profile-step': { onboarding: true }, plain: {} }
  const gate = withOnboardingGate(fake, (token) => {
    if (!users[token]) throw new ApiError(401, 'x')
    return users[token]
  })
  const passwordStep = ['POST /auth/login', 'POST /auth/demo-login', 'GET /auth/demo-users', 'POST /auth/logout', 'GET /core/me', 'POST /auth/change-password']
  const profileStep = [...passwordStep, 'GET /modules/team/me', 'GET /modules/team/fields', 'POST /modules/team/me/submission', 'PATCH /modules/team/me/submission', 'POST /modules/team/me/submission/cancel']
  for (const route of Object.keys(fake)) {
    for (const [token, allowed] of [['password-step', passwordStep], ['profile-step', profileStep], ['plain', Object.keys(fake)]]) {
      const run = () => gate[route]({ token })
      if (allowed.includes(route)) assert.equal(await run(), 'ok', `${token}: ${route}`)
      else await assert.rejects(async () => run(), (e) => e.status === 403, `${token}: ${route}`)
    }
  }
  // вход и выход пропускаются даже с токеном новичка, а без токена/с плохим токеном отвечает исходный обработчик
  assert.equal(await gate['GET /admin/users']({ token: 'bad' }), 'ok')
  assert.equal(await gate['GET /admin/users']({}), 'ok')
})

test('сквозной сценарий: вход общим паролем, смена пароля, анкета, одобрение HR, права', async () => {
  reset()
  const { token: t1 } = await login('onboarding@example.com', SHARED)
  // шаг «пароль»: анкета и остальное закрыты
  await rejects(call(t1, 'GET', '/modules/team/fields'), 403)
  await rejects(call(t1, 'GET', '/modules/team/map'), 403)
  await rejects(call(t1, 'GET', '/core/notifications'), 403)
  // новый пароль не может совпадать с общим
  await rejects(call(t1, 'POST', '/auth/change-password', { oldPassword: SHARED, newPassword: SHARED }), 422)
  await rejects(call(t1, 'POST', '/auth/change-password', { oldPassword: 'wrong-password', newPassword: 'My-new-password-1' }), 401)
  const { token: t2 } = await call(t1, 'POST', '/auth/change-password', { oldPassword: SHARED, newPassword: 'My-new-password-1' })
  await rejects(call(t1, 'GET', '/core/me'), 401) // старый токен закрыт
  const me2 = await call(t2, 'GET', '/core/me')
  assert.equal(me2.must_change_password, false)
  assert.equal(me2.onboarding, true)
  // общий пароль больше не работает, личный — да
  await rejects(login('onboarding@example.com', SHARED), 401)
  const { token: t3 } = await login('onboarding@example.com', 'My-new-password-1')
  // шаг «анкета»
  await rejects(call(t3, 'GET', '/modules/team/map'), 403)
  const fields = await call(t3, 'GET', '/modules/team/fields')
  assert.ok(fields.length > 0)
  const values = {
    first_name: 'Нина', last_name: 'Вымышленова', title: 'Тестировщик', manager_claim: 'Громов', responsibility: 'Проверки',
    ask_me_about: 'Тесты', location: 'Москва', work_format: 'Гибрид', telegram: 'nb_demo', hobbies: ['Чай'], gender: 'Женский',
  }
  const jpeg = (bytes) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(bytes - 4)]).toString('base64')}`
  const sent = await call(t3, 'POST', '/modules/team/me/submission', { values, photo: { full: jpeg(1000), thumb: jpeg(500) } })
  assert.equal(sent.status, 'pending')
  // HR (id 9): заявка помечена, справочник отделов, одобрение без уровня запрещено
  const hr = (await login('hr@example.com', 'demo')).token
  const list = await call(hr, 'GET', '/modules/team/hr/submissions?status=all')
  const sub = list.find((x) => x.userEmail === 'onboarding@example.com')
  assert.equal(sub.userOnboarding, true)
  assert.ok(list.filter((x) => x.userId !== sub.userId).every((x) => x.userOnboarding === false))
  const departments = await call(hr, 'GET', '/modules/team/hr/departments')
  assert.ok(departments.length > 0 && Object.keys(departments[0]).sort().join() === 'id,name')
  await rejects(call(t3, 'GET', '/modules/team/hr/departments'), 403)
  const approveBody = { directionId: 'ops', managerId: 3, tag: null, team: null, showInMap: true }
  const path = `/modules/team/hr/submissions/${sub.id}/approve`
  await rejects(call(hr, 'POST', path, approveBody), 422)
  await rejects(call(hr, 'POST', path, { ...approveBody, accessLevel: 'admin' }), 422)
  await rejects(call(hr, 'POST', path, { ...approveBody, accessLevel: 'employee', departmentIds: [999] }), 422)
  assert.equal((await call(t3, 'GET', '/core/me')).onboarding, true) // ничего не изменилось
  await call(hr, 'POST', path, { ...approveBody, accessLevel: 'employee', departmentIds: [1] })
  // после одобрения: флагов нет, права отдела, имя из анкеты, карта доступна
  const me3 = await call(t3, 'GET', '/core/me')
  assert.equal(me3.onboarding, false)
  assert.equal(me3.must_change_password, false)
  assert.equal(me3.access_level, 'employee')
  assert.equal(me3.full_name, 'Нина Вымышленова')
  assert.equal(me3.module_access.purchasing, 'run')
  assert.ok((await call(t3, 'GET', '/modules/team/map')).people.length > 0)
})

test('одобрение обычного пользователя: уровень и отделы из тела игнорируются', async () => {
  reset()
  const hr = (await login('hr@example.com', 'demo')).token
  const sub = (await call(hr, 'GET', '/modules/team/hr/submissions?status=all')).find((x) => x.userEmail === 'ani@example.com' && x.status === 'pending')
  assert.equal(sub.userOnboarding, false)
  await call(hr, 'POST', `/modules/team/hr/submissions/${sub.id}/approve`, { accessLevel: 'superuser', departmentIds: [5] })
  assert.equal(userOf('ani@example.com').access_level, 'employee')
  assert.deepEqual(userOf('ani@example.com').department_ids, [1])
})

test('админ: общий пароль, очистка, продление, завершение, удаление', async () => {
  reset()
  const admin = (await login('karen@example.com', 'demo')).token
  const info = await call(admin, 'GET', '/admin/onboarding')
  assert.equal(info.passwordSet, true)
  assert.deepEqual(info.domains, [info.domain])
  assert.ok(!JSON.stringify(info).includes(SHARED))
  await rejects(call(admin, 'POST', '/admin/onboarding/password', { password: 'short' }), 422)
  await rejects(call((await login('ani@example.com', 'demo')).token, 'GET', '/admin/onboarding'), 403)
  const cleared = await call(admin, 'POST', '/admin/onboarding/password', { password: '' })
  assert.equal(cleared.passwordSet, false)
  await rejects(login('nb-admin@example.com', SHARED), 401) // самосоздание выключено
  const set = await call(admin, 'POST', '/admin/onboarding/password', { password: 'Another-start-2026' })
  assert.equal(set.passwordSet, true)
  assert.ok(!JSON.stringify(set).includes('Another-start-2026'))
  // новичок
  const { token } = await login('nb-admin@example.com', 'Another-start-2026')
  const user = userOf('nb-admin@example.com')
  user.onboarding_expires_at = new Date(Date.now() - 1000).toISOString()
  await rejects(login('nb-admin@example.com', 'Another-start-2026'), 401) // срок истёк
  const extended = await call(admin, 'POST', `/admin/users/${user.id}/onboarding/extend`)
  assert.ok(Date.parse(extended.onboarding_expires_at) > Date.now())
  await login('nb-admin@example.com', 'Another-start-2026')
  // «завершить» только после смены пароля
  await rejects(call(admin, 'POST', `/admin/users/${user.id}/onboarding/finish`, { access_level: 'employee', department_ids: [] }), 422)
  await call(token, 'POST', '/auth/change-password', { oldPassword: 'Another-start-2026', newPassword: 'My-new-password-2' })
  await rejects(call(admin, 'POST', `/admin/users/${user.id}/onboarding/extend`), 422) // продлить можно только до смены пароля
  await rejects(call(admin, 'POST', `/admin/users/${user.id}/onboarding/finish`, { access_level: 'nope', department_ids: [] }), 422)
  const finished = await call(admin, 'POST', `/admin/users/${user.id}/onboarding/finish`, { access_level: 'superuser', department_ids: [] })
  assert.equal(finished.onboarding, false)
  assert.equal(finished.access_level, 'superuser')
  await rejects(call(admin, 'POST', `/admin/users/${user.id}/onboarding/delete`), 422) // уже не на онбординге
  // удаление: почта освобождается
  await login('nb-del@example.com', 'Another-start-2026')
  const del = userOf('nb-del@example.com')
  await call(admin, 'POST', `/admin/users/${del.id}/onboarding/delete`)
  assert.equal(userOf('nb-del@example.com'), undefined)
  await login('nb-del@example.com', 'Another-start-2026')
  assert.ok(userOf('nb-del@example.com'))
})
