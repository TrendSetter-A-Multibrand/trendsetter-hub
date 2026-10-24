import test from 'node:test'
import assert from 'node:assert/strict'

globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

const { computeModuleAccess, isModuleResponsible, canManageUsers } = await import('../../access.js')
const { data: hub, DEMO_PASSWORD } = await import('./data.js')
const { createTeamHandlers } = await import('./team.js')
const { createNotificationHandlers } = await import('./notifications.js')
const { createHrHandlers } = await import('./hr.js')
const { createHrOpsHandlers } = await import('./hrOps.js')
const { createAuditStore } = await import('./audit.js')
const { createAuthHandlers, issueToken, setPassword, userFromToken } = await import('./auth.js')
const { createMockTransport } = await import('./transport.js')

// Токен = issueToken(id) (mock:<id>:<версия>); права считаются как в handlers.js
const personal = (user, id) => [hub.userModulePermissions[user.id]?.[id]].filter(Boolean)
const accessTo = (user, id) => computeModuleAccess(user, hub.moduleDepartments[id] ?? [], personal(user, id), id === 'team')
const isResponsible = (user) => isModuleResponsible(user, personal(user, 'hr'))
const requireManager = (token) => userFromToken(token)
const findUser = (id) => hub.users.find((u) => u.id === Number(id))

function setup(now) {
  // пароли и версии токенов лежат в общих данных: каждый тест начинает с чистого состояния
  hub.passwords = {}
  hub.tokenVersions = {}
  const team = createTeamHandlers({ userFromToken, accessTo })
  const notifications = createNotificationHandlers({ userFromToken, requireManager, findUser })
  const audit = createAuditStore({ userFromToken, canView: (u) => isResponsible(u) || canManageUsers(u), byId: team.byId })
  const personIdOfUser = (userId) => team.people().find((p) => p.userId === userId)?.id ?? null
  const auth = createAuthHandlers({ userFromToken, audit, personIdOfUser, now })
  const hr = createHrHandlers({ userFromToken, accessTo, isResponsible, team, notify: notifications.notify, audit })
  const ops = createHrOpsHandlers({ userFromToken, accessTo, isResponsible, team, notify: notifications.notify, hr, audit })
  const transport = createMockTransport({ ...auth.handlers, ...audit.handlers, ...team.handlers, ...notifications.handlers, ...hr.handlers, ...ops.handlers })
  const call = (token, method, path, body) => transport({ method, path, body, token })
  const log = async (id, query = '') => (await call(issueToken(id), 'GET', `/modules/hr/audit${query}`)).items
  return { call, log }
}

const rejects = (promise, status) => assert.rejects(promise, (e) => e.status === status)
const LONG = 'новый-пароль-123'

test('смена пароля: 401 неверный старый, 422 короткий/длинный/без полей, 401 без токена', async () => {
  const { call } = setup()
  const t = issueToken(3)
  await rejects(call(t, 'POST', '/auth/change-password', { oldPassword: 'x', newPassword: LONG }), 401)
  await rejects(call(t, 'POST', '/auth/change-password', { oldPassword: DEMO_PASSWORD, newPassword: 'short' }), 422)
  await rejects(call(t, 'POST', '/auth/change-password', { oldPassword: DEMO_PASSWORD, newPassword: 'x'.repeat(129) }), 422)
  await rejects(call(t, 'POST', '/auth/change-password', { oldPassword: DEMO_PASSWORD }), 422)
  await rejects(call(null, 'POST', '/auth/change-password', { oldPassword: DEMO_PASSWORD, newPassword: LONG }), 401)
})

test('смена пароля: новый токен работает, старый недействителен, пароль в журнал не попадает', async () => {
  const { call, log } = setup()
  const old = issueToken(10)
  const { token } = await call(old, 'POST', '/auth/change-password', { oldPassword: DEMO_PASSWORD, newPassword: LONG })
  assert.notEqual(token, old)
  await rejects(call(old, 'GET', '/modules/hr/audit'), 401)
  assert.ok(Array.isArray(await log(1))) // токен администратора не затронут
  // старый пароль больше не подходит; новый не может совпасть сам с собой
  await rejects(call(token, 'POST', '/auth/change-password', { oldPassword: DEMO_PASSWORD, newPassword: `${LONG}2` }), 401)
  await rejects(call(token, 'POST', '/auth/change-password', { oldPassword: LONG, newPassword: LONG }), 422)
  const entry = (await log(1, '?action=core.password_change'))[0]
  assert.equal(entry.label, 'Смена пароля')
  assert.equal(entry.userName, 'Кравцов Денис')
  assert.equal(entry.personId, 10)
  assert.equal(JSON.stringify(entry).includes(LONG), false)
})

test('сброс пароля админом закрывает токены пользователя', () => {
  setup()
  const old = issueToken(4)
  assert.equal(userFromToken(old).id, 4)
  setPassword(4, 'другой-пароль-1')
  assert.throws(() => userFromToken(old), (e) => e.status === 401)
  assert.equal(userFromToken(issueToken(4)).id, 4)
})

test('токен без версии = версия 0; 5 неудач за 15 минут дают 429, потом окно истекает', async () => {
  let time = 1000
  const { call } = setup(() => time)
  const t = 'mock:4'
  for (let i = 0; i < 5; i++) await rejects(call(t, 'POST', '/auth/change-password', { oldPassword: 'bad', newPassword: LONG }), 401)
  await rejects(call(t, 'POST', '/auth/change-password', { oldPassword: DEMO_PASSWORD, newPassword: LONG }), 429)
  time += 15 * 60 * 1000 + 1
  const res = await call(t, 'POST', '/auth/change-password', { oldPassword: DEMO_PASSWORD, newPassword: LONG })
  assert.match(res.token, /^mock:4:1$/)
})

test('журнал: 403 без прав, доступ у responsible и администратора, поля ответа по контракту', async () => {
  const { call } = setup()
  await rejects(call(issueToken(9), 'GET', '/modules/hr/audit'), 403) // HR без responsible
  await rejects(call(issueToken(3), 'GET', '/modules/hr/audit'), 403)
  const resp = await call(issueToken(13), 'GET', '/modules/hr/audit')
  const admin = await call(issueToken(1), 'GET', '/modules/hr/audit')
  assert.ok(resp.total > 0 && admin.total > 0)
  assert.deepEqual(Object.keys(resp.items[0]).sort(), ['action', 'at', 'details', 'id', 'label', 'personId', 'personName', 'userName'])
})

test('журнал: sensitive, документы и экспорт пишутся без значений; просмотр журнала пишется только без фильтров', async () => {
  const { call, log } = setup()
  const t = issueToken(13)
  await call(t, 'GET', '/modules/hr/people/11/sensitive')
  await call(t, 'GET', '/modules/hr/people/11/documents')
  await call(t, 'PATCH', '/modules/hr/people/11/sensitive', { passport: 'ZZ 123456', bonusNote: 'секрет' })
  await call(t, 'GET', '/modules/hr/export/people')
  const items = await log(13, '?personId=11')
  assert.deepEqual(items.map((i) => i.action).sort(), ['hr.documents_list', 'hr.sensitive_update', 'hr.sensitive_view'])
  assert.equal(typeof items[0].personName, 'string')
  const update = items.find((i) => i.action === 'hr.sensitive_update')
  assert.deepEqual([...update.details.fields].sort(), ['bonusNote', 'passport'])
  assert.equal(JSON.stringify(items).includes('ZZ 123456'), false)
  assert.equal(JSON.stringify(items).includes('секрет'), false)
  const exports = await log(13, '?action=hr.export&limit=200')
  assert.equal(exports.some((e) => e.details.kind === 'people' && e.details.rows > 0), true)
  assert.equal((await log(13, '?action=hr.audit_view')).length, 0) // запросы с фильтрами не пишутся
  await log(13)
  assert.equal((await log(13, '?action=hr.audit_view')).length, 1)
})

test('журнал: action точное совпадение, период, пагинация, ошибки параметров', async () => {
  const { call, log } = setup()
  const t = issueToken(1)
  const all = await call(t, 'GET', '/modules/hr/audit?limit=200')
  assert.equal((await log(1, '?action=hr.sens')).length, 0) // префикс не поддерживается
  const two = await log(1, '?action=hr.sensitive_view,hr.export&limit=200') // список через запятую
  assert.ok(two.length > 0 && two.every((i) => ['hr.sensitive_view', 'hr.export'].includes(i.action)))
  await rejects(call(t, 'GET', '/modules/hr/audit?action=BAD'), 422)
  assert.ok((await log(1, '?action=hr.sensitive_view')).every((i) => i.action === 'hr.sensitive_view'))
  const page1 = await call(t, 'GET', '/modules/hr/audit?limit=2&offset=0')
  const page2 = await call(t, 'GET', '/modules/hr/audit?limit=2&offset=2')
  assert.equal(page1.items.length, 2)
  assert.notEqual(page1.items[0].id, page2.items[0].id)
  assert.equal((await log(1, '?from=2999-01-01')).length, 0)
  assert.ok((await log(1, '?from=2000-01-01&to=2999-01-01&limit=200')).length > 0)
  const times = all.items.map((i) => i.at)
  assert.deepEqual(times, [...times].sort().reverse()) // новые сверху
  for (const bad of ['?limit=201', '?limit=0', '?offset=-1', '?from=2026-13-01', '?from=2026-10-10&to=2026-10-01', '?personId=abc']) {
    await rejects(call(t, 'GET', `/modules/hr/audit${bad}`), 422)
  }
})

test('автоистория оклада: правка salary/currency создаёт запись salary auto=true, прочие поля и повтор — нет', async () => {
  const { call } = setup()
  const t = issueToken(13)
  const salaryRows = async () => (await call(t, 'GET', '/modules/hr/people/11/history')).filter((h) => h.kind === 'salary')
  const base = (await salaryRows()).length
  await call(t, 'PATCH', '/modules/hr/people/11/sensitive', { passport: 'AA 1' })
  assert.equal((await salaryRows()).length, base)
  assert.equal((await call(t, 'GET', '/modules/hr/people/11/sensitive')).salary, null) // первая установка
  await call(t, 'PATCH', '/modules/hr/people/11/sensitive', { salary: 120000, currency: 'RUB' })
  const autos = async () => (await salaryRows()).filter((h) => h.auto)
  const first = (await autos())[0]
  assert.equal(first.title, 'Изменение оклада')
  assert.equal(first.oldValue, null)
  assert.equal(first.newValue, '120000.00')
  assert.equal(first.effectiveDate.length, 10)
  await call(t, 'PATCH', '/modules/hr/people/11/sensitive', { salary: 150000 })
  assert.equal((await autos()).length, 2)
  assert.ok((await autos()).some((h) => h.oldValue === '120000.00' && h.newValue === '150000.00'))
  await call(t, 'PATCH', '/modules/hr/people/11/sensitive', { salary: 150000, currency: 'RUB' }) // без изменений
  assert.equal((await autos()).length, 2)
  const forHr = await call(issueToken(9), 'GET', '/modules/hr/people/11/history') // обычный HR salary не видит
  assert.equal(forHr.some((h) => h.kind === 'salary'), false)
})
