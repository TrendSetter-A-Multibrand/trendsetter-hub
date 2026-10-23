import test from 'node:test'
import assert from 'node:assert/strict'

// client.js -> session.js работает с sessionStorage — в Node его нет
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

const { computeModuleAccess, isModuleResponsible, canManageUsers } = await import('../../access.js')
const { data: hub } = await import('./data.js')
const { createTeamHandlers } = await import('./team.js')
const { createNotificationHandlers } = await import('./notifications.js')
const { createHrHandlers, computeBalance } = await import('./hr.js')
const { createMockTransport } = await import('./transport.js')
const { addDays, addMonths, countDays, formatDate, fullMonths, todayIso } = await import('../../dates.js')
const { ApiError } = await import('../client.js')

// token = id пользователя: 1 admin, 2 superuser, 3 Ани (подчинённая 10), 5 viewer, 9 HR (run), 10 Кравцов (руководитель),
// 11 Жуков (коллега Ани), 12 без карточки, 13 Назаров (HR с личным responsible)
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
  const transport = createMockTransport({ ...team.handlers, ...notifications.handlers, ...hr.handlers })
  const call = (token, method, path, body) => transport({ method, path, body, token })
  const hrCall = (token, method, path, body) => call(token, method, `/modules/hr${path}`, body)
  const inbox = async (token, kind) => (await call(token, 'GET', '/core/notifications')).filter((n) => !kind || n.kind === kind)
  return { call, hrCall, inbox, hr, notifications }
}

const rejects = (promise, status) => assert.rejects(promise, (e) => e.status === status)
const today = todayIso()
const day = (n) => addDays(today, n)

test('даты: полные месяцы, конец месяца, addMonths, countDays, formatDate', () => {
  assert.equal(fullMonths('2026-01-31', '2026-02-28'), 1)
  assert.equal(fullMonths('2026-01-15', '2026-02-14'), 0)
  assert.equal(fullMonths('2026-01-15', '2026-02-15'), 1)
  assert.equal(fullMonths('2025-10-23', '2026-10-23'), 12)
  assert.equal(addMonths('2026-08-31', 6), '2027-02-28')
  assert.equal(addMonths('2026-10-23', 6), '2027-04-23')
  assert.equal(countDays('2026-10-23', '2026-10-23'), 1)
  assert.equal(countDays('2026-02-27', '2026-03-02'), 4)
  assert.equal(formatDate('2026-10-03'), '03.10.2026')
})

test('баланс: накопление, первый отпуск, корректировки', () => {
  const policy = { daysPerYear: 28, accruePerMonth: 2.333, firstLeaveAfterMonths: 6 }
  assert.equal(computeBalance({ hiredAt: null, policy, today: '2026-10-23' }), null)
  const young = computeBalance({ hiredAt: '2026-08-23', policy, today: '2026-10-23' })
  assert.equal(young.accrued, 4.67)
  assert.equal(young.availableFrom, '2027-02-23')
  const adj = computeBalance({ hiredAt: '2025-10-23', policy, adjustments: [{ deltaDays: 5 }, { deltaDays: -2 }], today: '2026-10-23' })
  assert.equal(adj.accrued, 28)
  assert.equal(adj.adjust, 3)
  assert.equal(adj.availableFrom, null)
  assert.equal(adj.available, 31)
  // Армения: право сразу
  assert.equal(computeBalance({ hiredAt: '2026-10-01', policy: { ...policy, firstLeaveAfterMonths: 0 }, today: '2026-10-23' }).availableFrom, null)
})

test('баланс: used/planned по границе end < today, другие виды и статусы не списываются', () => {
  const policy = { daysPerYear: 28, accruePerMonth: 2.333, firstLeaveAfterMonths: 0 }
  const r = (kind, status, start, end, days) => ({ kind, status, start, end, days })
  const b = computeBalance({
    hiredAt: '2024-01-01',
    policy,
    today: '2026-10-23',
    requests: [
      r('annual', 'approved', '2026-10-10', '2026-10-22', 13), // закончился вчера -> used
      r('annual', 'approved', '2026-10-20', '2026-10-23', 4), // заканчивается сегодня -> planned
      r('annual', 'approved', '2026-12-01', '2026-12-05', 5),
      r('annual', 'pending', '2026-11-01', '2026-11-03', 3),
      r('annual', 'cancelled', '2026-11-10', '2026-11-12', 3),
      r('unpaid', 'approved', '2026-11-20', '2026-11-30', 11),
      r('sick', 'approved', '2026-09-01', '2026-09-10', 10),
    ],
  })
  assert.equal(b.used, 13)
  assert.equal(b.planned, 9)
  assert.equal(b.available, Math.round((b.accrued - 22) * 100) / 100)
})

test('уведомления: свои, непрочитанные, прочитать все / выборочно, чужие не трогаются', async () => {
  const { call, notifications } = setup()
  notifications.notify([3, 3, 5, 999], { kind: 'x', title: 'Один', body: 'b', link: '/a' })
  notifications.notify([3], { kind: 'x', title: 'Два', body: 'b' })
  const mine = await call(3, 'GET', '/core/notifications')
  assert.deepEqual(mine.map((n) => n.title), ['Два', 'Один'])
  assert.equal(notifications.unreadCount(userFromToken(3)), 2)
  await call(3, 'POST', '/core/notifications/read', { ids: [mine[0].id] })
  assert.equal((await call(3, 'GET', '/core/notifications?unread=1')).length, 1)
  await call(3, 'POST', '/core/notifications/read', { ids: null })
  assert.equal(notifications.unreadCount(userFromToken(3)), 0)
  assert.equal(notifications.unreadCount(userFromToken(5)), 1)
  await rejects(call(3, 'POST', '/core/notifications/read', { ids: ['a'] }), 422)
})

test('личные права: admin ставит и снимает, итог влияет на доступ и responsible; не-admin 403', async () => {
  const { call } = setup()
  const u12 = userFromToken(12)
  assert.equal(accessTo(u12, 'hr'), 'none')
  await rejects(call(3, 'PATCH', '/admin/users/12/module-permissions', { moduleId: 'hr', permission: 'run' }), 403)
  await rejects(call(1, 'PATCH', '/admin/users/12/module-permissions', { moduleId: 'nope', permission: 'run' }), 422)
  await rejects(call(1, 'PATCH', '/admin/users/12/module-permissions', { moduleId: 'hr', permission: 'god' }), 422)
  assert.deepEqual(await call(1, 'PATCH', '/admin/users/12/module-permissions', { moduleId: 'hr', permission: 'responsible' }), { permissions: { hr: 'responsible' } })
  assert.equal(accessTo(u12, 'hr'), 'run')
  assert.equal(isResponsible(u12), true)
  assert.deepEqual(await call(1, 'GET', '/admin/users/12/module-permissions'), { permissions: { hr: 'responsible' } })
  assert.deepEqual(await call(1, 'PATCH', '/admin/users/12/module-permissions', { moduleId: 'hr', permission: null }), { permissions: {} })
  assert.equal(accessTo(u12, 'hr'), 'none')
  assert.equal(isResponsible(userFromToken(13)), true)
  assert.equal(isResponsible(userFromToken(9)), false)
})

test('сценарий: заявка -> руководитель согласует -> коллеги и HR уведомлены, баланс', async () => {
  const { hrCall, inbox } = setup()
  const before = (await hrCall(3, 'GET', '/me/leave')).balance
  assert.equal((await hrCall(3, 'GET', '/me/leave')).approver.name, 'Кравцов Денис')
  const created = await hrCall(3, 'POST', '/me/leave/requests', { kind: 'annual', start: day(100), end: day(106), message: 'К Льву за срочным' })
  assert.equal(created.status, 'pending')
  assert.equal(created.days, 7)
  assert.equal(created.personName, 'Саркисян Ани')
  // руководитель получил уведомление со ссылкой, коллеги и HR — ещё нет
  const forManager = await inbox(10, 'leave_request')
  assert.equal(forManager.length, 1)
  assert.equal(forManager[0].link, '/profile?section=approvals')
  assert.equal((await inbox(11, 'leave_approved')).length, 0)
  assert.equal((await hrCall(10, 'GET', '/me/approvals')).filter((r) => r.status === 'pending').some((r) => r.id === created.id), true)
  // баланс пока не меняется
  assert.equal((await hrCall(3, 'GET', '/me/leave')).balance.planned, before.planned)

  await rejects(hrCall(11, 'POST', `/leave/requests/${created.id}/decision`, { approve: true }), 403)
  const approved = await hrCall(10, 'POST', `/leave/requests/${created.id}/decision`, { approve: true })
  assert.equal(approved.status, 'approved')
  assert.equal(approved.decidedBy, 'Кравцов Денис')
  await rejects(hrCall(10, 'POST', `/leave/requests/${created.id}/decision`, { approve: true }), 409)

  for (const token of [11, 9, 13, 1]) {
    const [n] = await inbox(token, 'leave_approved')
    assert.ok(n, `пользователь ${token} получил уведомление`)
    assert.match(n.body, new RegExp(`Саркисян Ани не будет на работе с ${formatDate(day(100))} по ${formatDate(day(106))}\\. Сообщение: К Льву за срочным`))
  }
  assert.equal((await inbox(10, 'leave_approved')).length, 0, 'решивший руководитель не уведомляется')
  assert.equal((await inbox(3, 'leave_approved')).length, 0, 'сам сотрудник — не «коллега»')
  assert.equal((await inbox(3, 'leave_decision')).length, 1)
  assert.equal((await inbox(12, 'leave_approved')).length, 0, 'посторонний не уведомляется')
  assert.equal((await hrCall(3, 'GET', '/me/leave')).balance.planned, before.planned + 7)

  // отзыв согласованной будущей заявки -> уведомление об отмене, баланс возвращается
  const cancelled = await hrCall(3, 'POST', `/me/leave/requests/${created.id}/cancel`)
  assert.equal(cancelled.status, 'cancelled')
  assert.equal((await inbox(11, 'leave_cancelled')).length, 1)
  assert.equal((await hrCall(3, 'GET', '/me/leave')).balance.planned, before.planned)
  await rejects(hrCall(3, 'POST', `/me/leave/requests/${created.id}/cancel`), 409)
})

test('отклонение: комментарий обязателен, сотрудник уведомлён, коллеги нет; отзыв pending без уведомлений коллегам', async () => {
  const { hrCall, inbox } = setup()
  const a = await hrCall(3, 'POST', '/me/leave/requests', { kind: 'unpaid', start: day(200), end: day(201), message: '' })
  await rejects(hrCall(10, 'POST', `/leave/requests/${a.id}/decision`, { approve: false }), 422)
  await rejects(hrCall(10, 'POST', `/leave/requests/${a.id}/decision`, { approve: false, comment: 'x'.repeat(501) }), 422)
  const rejected = await hrCall(10, 'POST', `/leave/requests/${a.id}/decision`, { approve: false, comment: 'Горит запуск' })
  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.decisionComment, 'Горит запуск')
  assert.match((await inbox(3, 'leave_decision'))[0].body, /Горит запуск/)
  assert.equal((await inbox(11, 'leave_approved')).length, 0)
  const b = await hrCall(3, 'POST', '/me/leave/requests', { kind: 'other', start: day(200), end: day(201) })
  assert.equal((await hrCall(3, 'POST', `/me/leave/requests/${b.id}/cancel`)).status, 'cancelled')
  assert.equal((await inbox(11, 'leave_cancelled')).length, 0)
})

test('валидация заявки: пересечение 409, прошлое 422, нет карточки 404, первый отпуск, чужая заявка', async () => {
  const { hrCall } = setup()
  await hrCall(3, 'POST', '/me/leave/requests', { kind: 'annual', start: day(300), end: day(305) })
  await rejects(hrCall(3, 'POST', '/me/leave/requests', { kind: 'unpaid', start: day(305), end: day(310) }), 409)
  await rejects(hrCall(3, 'POST', '/me/leave/requests', { kind: 'annual', start: day(-2), end: day(3) }), 422)
  await rejects(hrCall(3, 'POST', '/me/leave/requests', { kind: 'annual', start: day(5), end: day(3) }), 422)
  await rejects(hrCall(3, 'POST', '/me/leave/requests', { kind: 'weird', start: day(5), end: day(6) }), 422)
  await rejects(hrCall(3, 'POST', '/me/leave/requests', { kind: 'annual', start: day(5), end: day(6), message: 'x'.repeat(501) }), 422)
  await rejects(hrCall(12, 'POST', '/me/leave/requests', { kind: 'annual', start: day(5), end: day(6) }), 422)
  assert.deepEqual(await hrCall(12, 'GET', '/me/leave'), { person: null, policy: null, balance: null, requests: [], approver: null })
  // Ани по норме AM: право на отпуск сразу
  const mine = await hrCall(3, 'GET', '/me/leave')
  assert.equal(mine.balance.availableFrom, null)
  const other = mine.requests.find((r) => r.status === 'approved')
  await rejects(hrCall(11, 'POST', `/me/leave/requests/${other.id}/cancel`), 404)
})

test('руководитель без аккаунта: заявку согласует HR, бейдж hr', async () => {
  const { hrCall, inbox, hr } = setup()
  // у Кравцова руководитель — CEO без учётной записи
  assert.equal((await hrCall(10, 'GET', '/me/leave')).approver, null)
  assert.deepEqual(hr.moduleBadges(userFromToken(9)), {})
  const r = await hrCall(10, 'POST', '/me/leave/requests', { kind: 'annual', start: day(60), end: day(66), message: 'на связи' })
  assert.equal((await inbox(9, 'leave_request')).length, 1)
  assert.equal((await inbox(10, 'leave_request')).length, 0)
  assert.deepEqual(hr.moduleBadges(userFromToken(9)), { hr: 1 })
  assert.deepEqual(hr.moduleBadges(userFromToken(3)), {})
  await rejects(hrCall(3, 'POST', `/leave/requests/${r.id}/decision`, { approve: true }), 403)
  assert.equal((await hrCall(9, 'POST', `/leave/requests/${r.id}/decision`, { approve: true })).status, 'approved')
  assert.deepEqual(hr.moduleBadges(userFromToken(9)), {})
  // подчинённые Кравцова — не его «коллеги» (коллеги: тот же руководитель, сам руководитель, HR)
  assert.equal((await inbox(11, 'leave_approved')).length, 0)
  assert.equal((await inbox(13, 'leave_approved')).length, 1)
  assert.equal((await inbox(10, 'leave_decision')).length, 1)
})

test('досье: Hr читает и правит, sensitive только Resp, значения валидируются', async () => {
  const { hrCall } = setup()
  await rejects(hrCall(3, 'GET', '/people/11/file'), 403)
  const asHr = await hrCall(9, 'GET', '/people/11/file')
  assert.equal(asHr.canSeeSensitive, false)
  assert.equal(asHr.file.country, 'AM')
  assert.equal(asHr.leave.policy.country, 'AM')
  assert.equal((await hrCall(13, 'GET', '/people/11/file')).canSeeSensitive, true)
  await rejects(hrCall(9, 'GET', '/people/11/sensitive'), 403)
  await rejects(hrCall(9, 'PATCH', '/people/11/sensitive', { salary: 1 }), 403)
  const empty = await hrCall(13, 'GET', '/people/11/sensitive')
  assert.equal(empty.salary, null)
  await rejects(hrCall(13, 'PATCH', '/people/11/sensitive', { salary: -5 }), 422)
  await rejects(hrCall(13, 'PATCH', '/people/11/sensitive', { payDay1: 40 }), 422)
  const saved = await hrCall(13, 'PATCH', '/people/11/sensitive', { salary: 150000.5, currency: 'AMD', payDay1: 5, passport: 'AB 0000000' })
  assert.equal(saved.salary, 150000.5)
  assert.equal((await hrCall(13, 'GET', '/people/11/sensitive')).payDay1, 5)
  // досье: даты, страна, пустое = null
  await rejects(hrCall(9, 'PATCH', '/people/11/file', { hiredAt: '2026-13-01' }), 422)
  await rejects(hrCall(9, 'PATCH', '/people/11/file', { country: 'XX' }), 422)
  await rejects(hrCall(9, 'PATCH', '/people/999/file', { notes: 'x' }), 404)
  const patched = await hrCall(9, 'PATCH', '/people/11/file', { hiredAt: '2024-01-10', workSchedule: '  ', employmentType: 'gph' })
  assert.ok(patched.leave && patched.canSeeSensitive === false)
  const f = patched.file
  assert.equal(f.hiredAt, '2024-01-10')
  assert.equal(f.workSchedule, null)
  assert.equal(f.employmentType, 'gph')
  // «мои данные»: деньги не отдаются
  const mine = await hrCall(3, 'GET', '/me/file')
  assert.deepEqual(Object.keys(mine.file).sort(), ['country', 'hiredAt', 'legalName', 'workSchedule'])
})

test('HR: заявка за сотрудника задним числом, корректировка, список заявок, нормы', async () => {
  const { hrCall, inbox } = setup()
  const past = await hrCall(9, 'POST', '/people/12/leave/requests', { kind: 'annual', start: day(-30), end: day(-24), status: 'approved' })
  assert.equal(past.status, 'approved')
  assert.equal(past.decidedBy, 'Сотрудник HR')
  assert.equal((await inbox(10, 'leave_approved')).length, 0, 'задним числом — без уведомлений')
  await rejects(hrCall(9, 'POST', '/people/12/leave/requests', { kind: 'annual', start: day(-28), end: day(-26) }), 409)
  await rejects(hrCall(9, 'POST', '/people/12/leave/requests', { kind: 'annual', start: day(5), end: day(6), status: 'rejected' }), 422)
  await hrCall(9, 'POST', '/people/12/leave/requests', { kind: 'annual', start: day(10), end: day(11), status: 'approved' })
  assert.equal((await inbox(10, 'leave_approved')).length, 1)
  await rejects(hrCall(9, 'POST', '/people/12/leave/adjustments', { deltaDays: 0, reason: 'x' }), 422)
  await rejects(hrCall(9, 'POST', '/people/12/leave/adjustments', { deltaDays: 3, reason: '' }), 422)
  await hrCall(9, 'POST', '/people/12/leave/adjustments', { deltaDays: -4, reason: 'Отпуск до внедрения' })
  const leave = (await hrCall(9, 'GET', '/people/12/file')).leave
  assert.equal(leave.balance.adjust, -4)
  assert.equal(leave.balance.used, 7)
  assert.equal(leave.adjustments.length, 1)
  assert.equal((await hrCall(9, 'GET', '/leave/requests?status=approved&personId=12')).length, 3)
  assert.equal((await hrCall(9, 'GET', '/leave/requests?status=pending')).every((r) => r.status === 'pending'), true)
  await rejects(hrCall(9, 'GET', '/leave/requests?status=zzz'), 422)
  await rejects(hrCall(3, 'GET', '/leave/requests'), 403)
  // нормы
  assert.deepEqual((await hrCall(9, 'GET', '/leave/policies')).map((p) => p.country), ['RU', 'AM'])
  await rejects(hrCall(9, 'PATCH', '/leave/policies/RU', { daysPerYear: 30 }), 403)
  await rejects(hrCall(13, 'PATCH', '/leave/policies/XX', { daysPerYear: 30 }), 404)
  await rejects(hrCall(13, 'PATCH', '/leave/policies/RU', { firstLeaveAfterMonths: 1.5 }), 422)
  assert.equal((await hrCall(13, 'PATCH', '/leave/policies/RU', { daysPerYear: 30 })).daysPerYear, 30)
  assert.equal((await hrCall(9, 'GET', '/leave/policies'))[0].daysPerYear, 30)
})

test('календарь: Team, только approved без больничных, диапазон <= 400 дней', async () => {
  const { hrCall, inbox } = setup()
  await rejects(hrCall(5, 'GET', `/leave/calendar?from=${day(0)}&to=${day(30)}`), 403) // viewer: structure
  await rejects(hrCall(3, 'GET', `/leave/calendar?from=${day(0)}&to=${day(500)}`), 422)
  await rejects(hrCall(3, 'GET', '/leave/calendar?from=2026-02-30&to=2026-03-01'), 422)
  await hrCall(9, 'POST', '/people/12/leave/requests', { kind: 'sick', start: day(1), end: day(3), status: 'approved' })
  assert.equal((await inbox(10, 'leave_approved')).length, 0, 'больничный коллегам не рассылается')
  await hrCall(3, 'POST', '/me/leave/requests', { kind: 'annual', start: day(80), end: day(81) }) // pending
  const list = await hrCall(3, 'GET', `/leave/calendar?from=${day(0)}&to=${day(70)}`)
  assert.ok(list.length >= 2) // Ани (+40..+53) и Жуков (учёба +12..+18)
  assert.ok(list.every((e) => e.kind !== 'sick' && !('message' in e) && !('days' in e)))
  assert.deepEqual(Object.keys(list[0]).sort(), ['directionId', 'end', 'kind', 'name', 'personId', 'start'])
  assert.equal(list.some((e) => e.start === day(80)), false)
  assert.equal((await hrCall(3, 'GET', `/leave/calendar?from=${day(0)}&to=${day(7)}`)).length, 0)
})

test('HR отменяет заявку: pending/approved, 409 для отменённой, уведомления, awaitingHr', async () => {
  const { hrCall, inbox } = setup()
  const created = await hrCall(3, 'POST', '/me/leave/requests', { kind: 'annual', start: day(120), end: day(126), message: 'x' })
  assert.equal(created.awaitingHr, false, 'у руководителя есть аккаунт')
  await hrCall(10, 'POST', `/leave/requests/${created.id}/decision`, { approve: true })
  const before = await hrCall(3, 'GET', '/me/leave')
  await rejects(hrCall(3, 'POST', `/leave/requests/${created.id}/cancel`), 403)
  const cancelled = await hrCall(9, 'POST', `/leave/requests/${created.id}/cancel`)
  assert.equal(cancelled.status, 'cancelled')
  assert.equal((await hrCall(3, 'GET', '/me/leave')).balance.planned, before.balance.planned - 7)
  assert.equal((await inbox(3, 'leave_cancelled_by_hr')).length, 1)
  assert.equal((await inbox(11, 'leave_cancelled')).length, 1)
  await rejects(hrCall(9, 'POST', `/leave/requests/${created.id}/cancel`), 409)
  await rejects(hrCall(9, 'POST', '/leave/requests/9999/cancel'), 404)
})

test('документы: только Resp, валидация, лимит 50, скачивание и удаление', async () => {
  const { hrCall } = setup()
  const b64 = (n) => Buffer.alloc(n, 65).toString('base64')
  const valid = { category: 'contract', title: 'Договор', fileName: 'a.PDF', dataBase64: b64(10) }
  // права: HR (run) и обычный сотрудник — 403
  await rejects(hrCall(9, 'GET', '/people/11/documents'), 403)
  await rejects(hrCall(9, 'POST', '/people/11/documents', valid), 403)
  await rejects(hrCall(9, 'GET', '/documents/1'), 403)
  await rejects(hrCall(9, 'POST', '/documents/1/delete', {}), 403)
  await rejects(hrCall(3, 'GET', '/people/11/documents'), 403)
  // демо-данные: у 11 два документа, у 14 нет; содержимое в списке не отдаётся
  const demo = await hrCall(13, 'GET', '/people/11/documents')
  assert.equal(demo.length, 2)
  assert.equal(demo[0].dataBase64, undefined)
  assert.ok(demo[0].sizeBytes > 0 && demo[0].mime && demo[0].uploadedBy)
  assert.deepEqual(await hrCall(13, 'GET', '/people/14/documents'), [])
  await rejects(hrCall(13, 'GET', '/people/999/documents'), 404)
  await rejects(hrCall(13, 'POST', '/people/999/documents', valid), 404)
  // валидация
  const post = (patch) => hrCall(13, 'POST', '/people/14/documents', { ...valid, ...patch })
  await rejects(post({ category: 'xxx' }), 422)
  await rejects(post({ title: '  ' }), 422)
  await rejects(post({ title: 'x'.repeat(201) }), 422)
  await rejects(post({ fileName: 'virus.exe' }), 422)
  await rejects(post({ fileName: 'noext' }), 422)
  await rejects(post({ dataBase64: '!!!' }), 422)
  await rejects(post({ dataBase64: '' }), 422)
  await rejects(post({ dataBase64: b64(8 * 1024 * 1024 + 1) }), 422)
  const doc = await post({ dataBase64: b64(8 * 1024 * 1024) })
  assert.equal(doc.sizeBytes, 8 * 1024 * 1024)
  assert.equal(doc.mime, 'application/pdf')
  assert.equal(doc.uploadedBy, 'Назаров Тимур')
  // скачивание и удаление
  const file = await hrCall(13, 'GET', `/documents/${doc.id}`)
  assert.equal(file.fileName, 'a.PDF')
  assert.equal(file.dataBase64.length, b64(8 * 1024 * 1024).length)
  await rejects(hrCall(13, 'GET', '/documents/9999'), 404)
  assert.deepEqual(await hrCall(13, 'POST', `/documents/${doc.id}/delete`, {}), { ok: true })
  await rejects(hrCall(13, 'GET', `/documents/${doc.id}`), 404)
  await rejects(hrCall(13, 'POST', `/documents/${doc.id}/delete`, {}), 404)
  // лимит 50 на человека
  for (let i = 0; i < 50; i += 1) await post({ title: `Док ${i}` })
  await rejects(post({ title: 'лишний' }), 409)
  await hrCall(13, 'POST', '/people/15/documents', valid) // у другого человека лимит свой
})
