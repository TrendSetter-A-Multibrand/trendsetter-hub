import test from 'node:test'
import assert from 'node:assert/strict'

// client.js -> session.js работает с sessionStorage — в Node его нет
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

const { computeModuleAccess, isModuleResponsible, canManageUsers } = await import('../../access.js')
const { data: hub } = await import('./data.js')
const { createTeamHandlers } = await import('./team.js')
const { createNotificationHandlers } = await import('./notifications.js')
const { createHrHandlers } = await import('./hr.js')
const { createPlanHandlers } = await import('./hr-plans.js')
const { createMockTransport } = await import('./transport.js')
const { addDays, todayIso } = await import('../../dates.js')
const { ApiError } = await import('../client.js')

// token = id пользователя: 3 Ани (карточка 11, подчинённая 10), 5 viewer (structure), 9 HR (run, карточка 14), 10 Кравцов (карточка 10,
// руководитель 11/12/13), 11 Жуков (карточка 12), 12 без карточки, 13 Назаров (HR, карточка 15)
const userFromToken = (token) => hub.users.find((u) => u.id === Number(token))
const personal = (user, id) => [hub.userModulePermissions[user.id]?.[id]].filter(Boolean)
const accessTo = (user, id) => computeModuleAccess(user, hub.moduleDepartments[id] ?? [], personal(user, id), id === 'team')
const isResponsible = (user) => isModuleResponsible(user, personal(user, 'hr'))
const requireManager = (token) => {
  const user = userFromToken(token)
  if (!canManageUsers(user)) throw new ApiError(403, 'forbidden')
  return user
}
const findUser = (id) => hub.users.find((u) => u.id === Number(id))

function setup() {
  const team = createTeamHandlers({ userFromToken, accessTo })
  const notifications = createNotificationHandlers({ userFromToken, requireManager, findUser })
  const hr = createHrHandlers({ userFromToken, accessTo, isResponsible, team, notify: notifications.notify })
  const plans = createPlanHandlers({ userFromToken, accessTo, team, hr })
  const transport = createMockTransport({ ...team.handlers, ...notifications.handlers, ...hr.handlers, ...plans.handlers })
  const call = (token, method, path, body) => transport({ method, path, body, token })
  return { hrCall: (token, method, path, body) => call(token, method, `/modules/hr${path}`, body), call }
}

const rejects = (promise, status) => assert.rejects(promise, (e) => e.status === status)
const today = todayIso()
const day = (n) => addDays(today, n)
const year = Number(today.slice(0, 4))

test('свои документы: только отмеченные HR, чужие и скрытые — 404', async () => {
  const { hrCall } = setup()
  const list = await hrCall(3, 'GET', '/me/documents')
  assert.deepEqual(list.map((d) => d.id), [1]) // документ 2 (паспорт) HR не показал
  assert.deepEqual(Object.keys(list[0]).sort(), ['category', 'fileName', 'id', 'sizeBytes', 'title', 'uploadedAt'])
  const file = await hrCall(3, 'GET', '/me/documents/1')
  assert.equal(file.fileName, 'contract-demo.txt')
  assert.ok(file.dataBase64)
  await rejects(hrCall(3, 'GET', '/me/documents/2'), 404)
  await rejects(hrCall(3, 'GET', '/me/documents/3'), 404) // чужой
  await rejects(hrCall(11, 'GET', '/me/documents/1'), 404) // чужой, но отмеченный
  assert.deepEqual(await hrCall(11, 'GET', '/me/documents'), [])
  assert.deepEqual(await hrCall(12, 'GET', '/me/documents'), []) // нет карточки
})

test('мой план: список по году, добавление, пересечение 409, прошлое 422, год, комментарий', async () => {
  const { hrCall } = setup()
  const before = await hrCall(3, 'GET', `/me/leave/plans?year=${year}`)
  assert.ok(before.every((p) => p.start.startsWith(String(year)) || p.end.startsWith(String(year))))
  const created = await hrCall(3, 'POST', '/me/leave/plans', { start: day(20), end: day(22), comment: '  Короткая поездка ' })
  assert.equal(created.status, 'planned')
  assert.equal(created.comment, 'Короткая поездка')
  assert.equal(created.requestId, null)
  await rejects(hrCall(3, 'POST', '/me/leave/plans', { start: day(21), end: day(25) }), 409)
  await rejects(hrCall(3, 'POST', '/me/leave/plans', { start: day(-3), end: day(2) }), 422)
  await rejects(hrCall(3, 'POST', '/me/leave/plans', { start: day(5), end: day(4) }), 422)
  await rejects(hrCall(3, 'POST', '/me/leave/plans', { start: `${year + 2}-01-10`, end: `${year + 2}-01-12` }), 422)
  await rejects(hrCall(3, 'POST', '/me/leave/plans', { start: day(30), end: day(31), comment: 'я'.repeat(301) }), 422)
  await rejects(hrCall(12, 'POST', '/me/leave/plans', { start: day(30), end: day(31) }), 422) // нет карточки
  await rejects(hrCall(3, 'GET', '/me/leave/plans?year=abc'), 422)
})

test('отмена плана: освобождает даты, повтор и чужой план — ошибки', async () => {
  const { hrCall } = setup()
  const created = await hrCall(3, 'POST', '/me/leave/plans', { start: day(20), end: day(22) })
  const cancelled = await hrCall(3, 'POST', `/me/leave/plans/${created.id}/cancel`)
  assert.equal(cancelled.status, 'cancelled')
  await rejects(hrCall(3, 'POST', `/me/leave/plans/${created.id}/cancel`), 409)
  await rejects(hrCall(11, 'POST', `/me/leave/plans/${created.id}/cancel`), 404)
  assert.equal((await hrCall(3, 'POST', '/me/leave/plans', { start: day(20), end: day(22) })).status, 'planned')
})

test('«Создать заявку»: заявка в обычном потоке, план converted, повтор 409', async () => {
  const { hrCall } = setup()
  const created = await hrCall(3, 'POST', '/me/leave/plans', { start: day(20), end: day(22), comment: 'Поездка' })
  const converted = await hrCall(3, 'POST', `/me/leave/plans/${created.id}/request`, { message: 'На связи в Telegram' })
  assert.equal(converted.status, 'converted')
  assert.ok(converted.requestId)
  const mine = await hrCall(3, 'GET', '/me/leave')
  const request = mine.requests.find((r) => r.id === converted.requestId)
  assert.equal(request.status, 'pending') // согласует руководитель (Кравцов)
  assert.equal(request.start, day(20))
  assert.equal(request.end, day(22))
  assert.equal(request.kind, 'annual')
  assert.equal(request.message, 'На связи в Telegram')
  const approvals = await hrCall(10, 'GET', '/me/approvals')
  assert.ok(approvals.some((r) => r.id === converted.requestId))
  await rejects(hrCall(3, 'POST', `/me/leave/plans/${created.id}/request`, { message: '' }), 409)
  await rejects(hrCall(3, 'POST', '/me/leave/plans/9999/request', { message: '' }), 404)
})

test('«Создать заявку»: ошибки существующего потока (пересечение с заявкой) не меняют план', async () => {
  const { hrCall } = setup()
  // у Ани согласованный отпуск day(40)..day(53); плановый период поверх него — допустим, а заявка — 409
  const created = await hrCall(3, 'POST', '/me/leave/plans', { start: day(45), end: day(46) })
  await rejects(hrCall(3, 'POST', `/me/leave/plans/${created.id}/request`, { message: '' }), 409)
  const list = await hrCall(3, 'GET', `/me/leave/plans?year=${day(45).slice(0, 4)}`)
  assert.equal(list.find((p) => p.id === created.id).status, 'planned')
})

test('план команды: руководитель видит подчинённых без отменённых; не руководитель — 403', async () => {
  const { hrCall } = setup()
  const team = await hrCall(10, 'GET', `/me/leave/team-plan?year=${day(40).slice(0, 4)}`)
  assert.ok(team.length > 0)
  assert.ok(team.every((p) => ['planned', 'converted'].includes(p.status)))
  assert.ok(team.every((p) => [11, 12, 13].includes(p.personId)))
  assert.ok(team.some((p) => p.personId === 11 && p.name === 'Саркисян Ани'))
  assert.equal(Object.keys(team[0]).sort().join(), 'comment,end,name,personId,start,status')
  await rejects(hrCall(3, 'GET', '/me/leave/team-plan'), 403)
  await rejects(hrCall(12, 'GET', '/me/leave/team-plan'), 403)
})

test('график HR: все не отменённые планы с направлением; не HR — 403', async () => {
  const { hrCall } = setup()
  const all = await hrCall(9, 'GET', `/leave/plan?year=${day(40).slice(0, 4)}`)
  assert.ok(all.every((p) => p.status !== 'cancelled'))
  assert.ok(all.some((p) => p.personId === 11 && p.directionId === 'buy'))
  assert.equal(Object.keys(all[0]).sort().join(), 'comment,directionId,end,id,name,personId,start,status')
  await rejects(hrCall(3, 'GET', '/leave/plan'), 403)
  await rejects(hrCall(5, 'GET', '/leave/plan'), 403)
  // отмена плана убирает его из графика HR
  const created = await hrCall(3, 'POST', '/me/leave/plans', { start: day(20), end: day(22) })
  const y = day(20).slice(0, 4)
  assert.ok((await hrCall(9, 'GET', `/leave/plan?year=${y}`)).some((p) => p.id === created.id))
  await hrCall(3, 'POST', `/me/leave/plans/${created.id}/cancel`)
  assert.ok(!(await hrCall(9, 'GET', `/leave/plan?year=${y}`)).some((p) => p.id === created.id))
})

test('дни рождения: день и месяц без года, скрытые и structure исключены', async () => {
  const { hrCall } = setup()
  const month = (iso) => iso.slice(0, 7)
  const now = await hrCall(3, 'GET', `/birthdays?month=${month(today)}`)
  const belova = now.find((b) => b.personId === 7)
  assert.deepEqual(belova, { personId: 7, name: 'Белова Инна', directionId: 'mkt', day: Number(today.slice(8)), month: Number(today.slice(5, 7)) })
  assert.ok(now.every((b) => Object.keys(b).sort().join() === 'day,directionId,month,name,personId'))
  // Фролова (14) скрыта: ни в одном из соседних месяцев её нет
  for (const d of [day(-35), today, day(35)]) assert.ok(!(await hrCall(3, 'GET', `/birthdays?month=${month(d)}`)).some((b) => b.personId === 14))
  assert.ok((await hrCall(3, 'GET', `/birthdays?month=${month(day(6))}`)).some((b) => b.personId === 12))
  assert.deepEqual(await hrCall(3, 'GET', '/birthdays'), now) // по умолчанию — текущий месяц
  await rejects(hrCall(5, 'GET', '/birthdays'), 403) // structure
  await rejects(hrCall(3, 'GET', '/birthdays?month=2026-13'), 422)
  await rejects(hrCall(3, 'GET', '/birthdays?month=abc'), 422)
})

test('birthdayHidden (PATCH досье, HR): скрывает день рождения; поле только для HR', async () => {
  const { hrCall } = setup()
  const m = today.slice(0, 7)
  assert.ok((await hrCall(3, 'GET', `/birthdays?month=${m}`)).some((b) => b.personId === 7))
  const file = await hrCall(9, 'PATCH', '/people/7/file', { birthdayHidden: true })
  assert.equal(file.file.birthdayHidden, true)
  assert.ok(!(await hrCall(3, 'GET', `/birthdays?month=${m}`)).some((b) => b.personId === 7))
  await rejects(hrCall(9, 'PATCH', '/people/7/file', { birthdayHidden: 'да' }), 422)
  await rejects(hrCall(3, 'PATCH', '/people/7/file', { birthdayHidden: false }), 403)
})
