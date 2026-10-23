import test from 'node:test'
import assert from 'node:assert/strict'

// client.js -> session.js работает с sessionStorage — в Node его нет
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

const { computeModuleAccess, isModuleResponsible, canManageUsers } = await import('../../access.js')
const { data: hub } = await import('./data.js')
const { createTeamHandlers } = await import('./team.js')
const { createNotificationHandlers } = await import('./notifications.js')
const { createHrHandlers } = await import('./hr.js')
const { createHrOpsHandlers } = await import('./hrOps.js')
const { createMockTransport } = await import('./transport.js')
const { addDays, formatDate, todayIso } = await import('../../dates.js')
const { ApiError } = await import('../client.js')
const XLSX = await import('xlsx').then((m) => m.default ?? m)

// token = id пользователя: 1 admin, 3 Ани (карточка 11), 9 HR (run, карточка 14), 10 Кравцов (карточка 10, руководитель),
// 11 Жуков (карточка 12), 13 Назаров (HR с личным responsible, карточка 15). Карточка 13 (Захарова) — без аккаунта.
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
  const ops = createHrOpsHandlers({ userFromToken, accessTo, isResponsible, team, notify: notifications.notify, hr })
  const transport = createMockTransport({ ...team.handlers, ...notifications.handlers, ...hr.handlers, ...ops.handlers })
  const call = (token, method, path, body) => transport({ method, path, body, token })
  const hrCall = (token, method, path, body) => call(token, method, `/modules/hr${path}`, body)
  const inbox = async (token, kind) => (await call(token, 'GET', '/core/notifications')).filter((n) => !kind || n.kind === kind)
  return { call, hrCall, inbox }
}

const rejects = (promise, status) => assert.rejects(promise, (e) => e.status === status)
const today = todayIso()
const day = (n) => addDays(today, n)
const readSheets = (dataBase64) => {
  const wb = XLSX.read(dataBase64, { type: 'base64' })
  return Object.fromEntries(wb.SheetNames.map((n) => [n, XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1 })]))
}

test('история: salary видит и создаёт только responsible, ручные записи валидируются', async () => {
  const { hrCall } = setup()
  await rejects(hrCall(3, 'GET', '/people/11/history'), 403)
  await rejects(hrCall(9, 'GET', '/people/999/history'), 404)
  const forHr = await hrCall(9, 'GET', '/people/11/history')
  const forResp = await hrCall(13, 'GET', '/people/11/history')
  assert.equal(forHr.some((h) => h.kind === 'salary'), false)
  assert.equal(forResp.some((h) => h.kind === 'salary'), true)
  assert.equal(forResp.length, forHr.length + 1)
  assert.deepEqual(forResp.map((h) => h.effectiveDate), [...forResp.map((h) => h.effectiveDate)].sort().reverse())
  assert.deepEqual(Object.keys(forResp[0]).sort(), ['auto', 'comment', 'createdAt', 'createdBy', 'effectiveDate', 'id', 'kind', 'newValue', 'oldValue', 'title'])

  const valid = { kind: 'other', effectiveDate: day(-1), title: 'Выдан бейдж' }
  await rejects(hrCall(9, 'POST', '/people/11/history', { ...valid, kind: 'salary' }), 403)
  await rejects(hrCall(9, 'POST', '/people/11/history', { ...valid, kind: 'weird' }), 422)
  await rejects(hrCall(9, 'POST', '/people/11/history', { ...valid, effectiveDate: '2026-02-30' }), 422)
  await rejects(hrCall(9, 'POST', '/people/11/history', { ...valid, title: ' ' }), 422)
  await rejects(hrCall(9, 'POST', '/people/11/history', { ...valid, title: 'x'.repeat(201) }), 422)
  await rejects(hrCall(9, 'POST', '/people/11/history', { ...valid, comment: 'x'.repeat(501) }), 422)
  await rejects(hrCall(9, 'POST', '/people/999/history', valid), 404)
  const manual = await hrCall(9, 'POST', '/people/11/history', { ...valid, oldValue: 'A', newValue: 'B' })
  assert.equal(manual.auto, false)
  assert.equal(manual.createdBy, 'Сотрудник HR')
  const salary = await hrCall(13, 'POST', '/people/11/history', { kind: 'salary', effectiveDate: day(0), title: 'Индексация', newValue: '150 000' })
  assert.equal(salary.kind, 'salary')
  assert.equal((await hrCall(9, 'GET', '/people/11/history')).some((h) => h.id === salary.id), false)
})

test('история: удаление — HR только ручные не salary, responsible любые', async () => {
  const { hrCall } = setup()
  const list = await hrCall(13, 'GET', '/people/11/history')
  const auto = list.find((h) => h.auto)
  const salary = list.find((h) => h.kind === 'salary')
  const manual = list.find((h) => !h.auto && h.kind !== 'salary')
  await rejects(hrCall(3, 'POST', `/history/${manual.id}/delete`, {}), 403)
  await rejects(hrCall(9, 'POST', `/history/${auto.id}/delete`, {}), 403)
  await rejects(hrCall(9, 'POST', `/history/${salary.id}/delete`, {}), 403)
  await rejects(hrCall(9, 'POST', '/history/9999/delete', {}), 404)
  assert.deepEqual(await hrCall(9, 'POST', `/history/${manual.id}/delete`, {}), { ok: true })
  await rejects(hrCall(9, 'POST', `/history/${manual.id}/delete`, {}), 404)
  await hrCall(13, 'POST', `/history/${auto.id}/delete`, {})
  await hrCall(13, 'POST', `/history/${salary.id}/delete`, {})
  assert.equal((await hrCall(13, 'GET', '/people/11/history')).length, 0)
})

test('автоистория при PATCH карточки: только реальные изменения, откат ничего не пишет', async () => {
  const { call, hrCall } = setup()
  const patch = (body) => call(9, 'PATCH', '/modules/team/hr/people/12', body)
  const before = (await hrCall(9, 'GET', '/people/12/history')).length
  // форма HR шлёт все поля при каждом сохранении — без изменений записей нет
  await patch({ title: 'Аналитик закупок', directionId: 'buy', managerId: 10, tag: 'новый тег' })
  assert.equal((await hrCall(9, 'GET', '/people/12/history')).length, before)
  // откатившийся запрос (неизвестное направление) ничего не пишет
  await rejects(patch({ title: 'Старший аналитик', directionId: 'nope' }), 422)
  assert.equal((await hrCall(9, 'GET', '/people/12/history')).length, before)

  await patch({ title: 'Старший аналитик закупок', managerId: 3, directionId: 'ops' })
  const added = (await hrCall(9, 'GET', '/people/12/history')).filter((h) => h.auto && h.effectiveDate === today)
  assert.deepEqual(added.map((h) => h.kind).sort(), ['direction', 'manager', 'position'])
  const position = added.find((h) => h.kind === 'position')
  assert.deepEqual([position.oldValue, position.newValue, position.createdBy], ['Аналитик закупок', 'Старший аналитик закупок', 'Сотрудник HR'])
  const manager = added.find((h) => h.kind === 'manager')
  assert.deepEqual([manager.oldValue, manager.newValue], ['Кравцов Денис', 'Громов Павел'], 'читаемые имена, не id')
  assert.deepEqual([added.find((h) => h.kind === 'direction').oldValue, added.find((h) => h.kind === 'direction').newValue], ['Закупки', 'Операции'])

  await patch({ isArchived: true })
  await patch({ isArchived: false })
  const status = (await hrCall(9, 'GET', '/people/12/history')).filter((h) => h.kind === 'status')
  assert.deepEqual(status.map((h) => h.newValue).sort(), ['Работает', 'Уволен'])
})

test('оборудование: права, валидация, возврат, удаление, лимит 100', async () => {
  const { hrCall } = setup()
  await rejects(hrCall(3, 'GET', '/people/12/equipment'), 403)
  await rejects(hrCall(9, 'GET', '/people/999/equipment'), 404)
  const seeded = await hrCall(9, 'GET', '/people/12/equipment')
  assert.equal(seeded.length, 1)
  assert.deepEqual(Object.keys(seeded[0]).sort(), ['comment', 'id', 'issuedAt', 'kind', 'name', 'returnDue', 'returnedAt', 'serial'])
  assert.ok(seeded[0].returnDue < today && seeded[0].returnedAt === null, 'демо: просроченный возврат')

  const valid = { kind: 'phone', name: 'Телефон демо', issuedAt: day(-1) }
  await rejects(hrCall(9, 'POST', '/people/14/equipment', { ...valid, kind: 'car' }), 422)
  await rejects(hrCall(9, 'POST', '/people/14/equipment', { ...valid, name: ' ' }), 422)
  await rejects(hrCall(9, 'POST', '/people/14/equipment', { ...valid, name: 'x'.repeat(121) }), 422)
  await rejects(hrCall(9, 'POST', '/people/14/equipment', { ...valid, issuedAt: 'вчера' }), 422)
  const item = await hrCall(9, 'POST', '/people/14/equipment', { ...valid, serial: 'SN-1', returnDue: day(30), comment: 'в чехле' })
  assert.equal(item.serial, 'SN-1')
  assert.equal(item.returnedAt, null)

  await rejects(hrCall(9, 'PATCH', `/equipment/${item.id}`, { returnedAt: 'x' }), 422)
  await rejects(hrCall(9, 'PATCH', '/equipment/9999', { name: 'a' }), 404)
  await rejects(hrCall(3, 'PATCH', `/equipment/${item.id}`, { name: 'a' }), 403)
  const returned = await hrCall(9, 'PATCH', `/equipment/${item.id}`, { returnedAt: today })
  assert.equal(returned.returnedAt, today)
  assert.equal(returned.name, 'Телефон демо')
  assert.equal((await hrCall(9, 'PATCH', `/equipment/${item.id}`, { returnedAt: null })).returnedAt, null)

  assert.deepEqual(await hrCall(9, 'POST', `/equipment/${item.id}/delete`, {}), { ok: true })
  await rejects(hrCall(9, 'POST', `/equipment/${item.id}/delete`, {}), 404)
  for (let i = 0; i < 100; i += 1) await hrCall(9, 'POST', '/people/14/equipment', { ...valid, name: `Устройство ${i}` })
  await rejects(hrCall(9, 'POST', '/people/14/equipment', valid), 409)
  await hrCall(9, 'POST', '/people/15/equipment', valid) // у другого человека лимит свой
})

test('шаблоны чек-листов: создание, правка пунктов целиком, выключение, валидация', async () => {
  const { hrCall } = setup()
  await rejects(hrCall(3, 'GET', '/checklist-templates'), 403)
  const seeded = await hrCall(9, 'GET', '/checklist-templates')
  assert.deepEqual(seeded.map((t) => t.kind), ['onboarding', 'offboarding'])
  assert.ok(seeded.every((t) => t.active && t.items.length >= 5 && t.items.length <= 7))

  await rejects(hrCall(9, 'POST', '/checklist-templates', { kind: 'x', title: 'a', items: [{ title: 'p' }] }), 422)
  await rejects(hrCall(9, 'POST', '/checklist-templates', { kind: 'onboarding', title: ' ', items: [{ title: 'p' }] }), 422)
  await rejects(hrCall(9, 'POST', '/checklist-templates', { kind: 'onboarding', title: 'a', items: [] }), 422)
  await rejects(hrCall(9, 'POST', '/checklist-templates', { kind: 'onboarding', title: 'a', items: [{ title: ' ' }] }), 422)
  await rejects(hrCall(9, 'POST', '/checklist-templates', { kind: 'onboarding', title: 'a', items: [{ title: 'p', daysOffset: -1 }] }), 422)
  await rejects(hrCall(9, 'POST', '/checklist-templates', { kind: 'onboarding', title: 'a', items: [{ title: 'p', daysOffset: 1.5 }] }), 422)
  const created = await hrCall(9, 'POST', '/checklist-templates', { kind: 'onboarding', title: 'Стажёр', items: [{ title: 'Первый', daysOffset: 2 }, { title: 'Второй' }] })
  assert.deepEqual(created.items.map((i) => [i.title, i.sort, i.daysOffset]), [['Первый', 1, 2], ['Второй', 2, null]])
  assert.equal(created.active, true)

  await rejects(hrCall(9, 'PATCH', '/checklist-templates/9999', { title: 'a' }), 404)
  await rejects(hrCall(9, 'PATCH', `/checklist-templates/${created.id}`, { active: 'yes' }), 422)
  const replaced = await hrCall(9, 'PATCH', `/checklist-templates/${created.id}`, { title: 'Стажёр 2', items: [{ title: 'Новый', daysOffset: 0 }] })
  assert.deepEqual([replaced.title, replaced.items.length, replaced.items[0].title], ['Стажёр 2', 1, 'Новый'])
  assert.equal((await hrCall(9, 'PATCH', `/checklist-templates/${created.id}`, { active: false })).active, false)
  assert.equal((await hrCall(9, 'GET', '/checklist-templates')).find((t) => t.id === created.id).active, false)
})

test('чек-листы: запуск из шаблона, назначение, права исполнителя, завершение, уведомления', async () => {
  const { hrCall, inbox } = setup()
  await rejects(hrCall(3, 'GET', '/people/12/checklists'), 403)
  await rejects(hrCall(9, 'GET', '/people/999/checklists'), 404)
  // демо: у Захаровой (13) чек-лист онбординга в работе
  const demo = await hrCall(9, 'GET', '/people/13/checklists')
  assert.equal(demo.length, 1)
  assert.equal(demo[0].status, 'active')
  assert.deepEqual(Object.keys(demo[0].items[0]).sort(), ['assignee', 'done', 'doneAt', 'doneBy', 'dueDate', 'id', 'note', 'sort', 'title'])

  const [onboarding, offboarding] = await hrCall(9, 'GET', '/checklist-templates')
  await rejects(hrCall(3, 'POST', '/people/12/checklists', { templateId: onboarding.id }), 403)
  await rejects(hrCall(9, 'POST', '/people/12/checklists', { templateId: 9999 }), 404)
  await rejects(hrCall(9, 'POST', '/people/999/checklists', { templateId: onboarding.id }), 404)
  await rejects(hrCall(9, 'POST', '/people/12/checklists', { templateId: onboarding.id, startedAt: 'вчера' }), 422)
  await hrCall(9, 'PATCH', `/checklist-templates/${offboarding.id}`, { active: false })
  await rejects(hrCall(9, 'POST', '/people/12/checklists', { templateId: offboarding.id }), 422)

  const c = await hrCall(9, 'POST', '/people/12/checklists', { templateId: onboarding.id, startedAt: day(10) })
  assert.equal(c.status, 'active')
  assert.equal(c.kind, 'onboarding')
  assert.equal(c.items.length, onboarding.items.length)
  c.items.forEach((item, i) => {
    assert.equal(item.dueDate, onboarding.items[i].daysOffset === null ? null : day(10 + onboarding.items[i].daysOffset))
    assert.deepEqual([item.done, item.assignee], [false, null])
  })

  // назначение: исполнитель получает уведомление, самоназначение и повтор — нет
  const [first, second] = c.items
  await rejects(hrCall(9, 'PATCH', `/checklist-items/${first.id}`, { assigneeUserId: 999 }), 422)
  await rejects(hrCall(9, 'PATCH', `/checklist-items/${first.id}`, { dueDate: '2026-13-01' }), 422)
  await rejects(hrCall(9, 'PATCH', `/checklist-items/${first.id}`, { note: 'x'.repeat(501) }), 422)
  await rejects(hrCall(9, 'PATCH', `/checklist-items/${first.id}`, { done: 'да' }), 422)
  await rejects(hrCall(9, 'PATCH', '/checklist-items/99999', { done: true }), 404)
  await hrCall(9, 'PATCH', `/checklist-items/${first.id}`, { assigneeUserId: 10, dueDate: day(11), note: ' позвонить ' })
  await hrCall(9, 'PATCH', `/checklist-items/${first.id}`, { assigneeUserId: 10 })
  await hrCall(9, 'PATCH', `/checklist-items/${second.id}`, { assigneeUserId: 9 })
  const toAssignee = await inbox(10, 'checklist_assigned')
  assert.equal(toAssignee.length, 1)
  assert.equal(toAssignee[0].link, '/modules/hr')
  assert.match(toAssignee[0].body, /Жуков Лев/)
  assert.equal((await inbox(9, 'checklist_assigned')).length, 0, 'самому себе не уведомляем')
  const afterAssign = (await hrCall(9, 'GET', '/people/12/checklists'))[0]
  assert.deepEqual([afterAssign.items[0].assignee, afterAssign.items[0].dueDate, afterAssign.items[0].note], [{ id: 10, name: 'Кравцов Денис' }, day(11), 'позвонить'])
  assert.equal((await hrCall(9, 'PATCH', `/checklist-items/${first.id}`, { assigneeUserId: null })).assignee, null)
  await hrCall(9, 'PATCH', `/checklist-items/${first.id}`, { assigneeUserId: 10 })

  // исполнитель (не HR): done и note своего пункта; чужой пункт, назначение и срок — 403
  await rejects(hrCall(10, 'GET', '/people/12/checklists'), 403)
  await rejects(hrCall(10, 'PATCH', `/checklist-items/${second.id}`, { done: true }), 404)
  await rejects(hrCall(10, 'PATCH', `/checklist-items/${first.id}`, { assigneeUserId: 10 }), 403)
  await rejects(hrCall(10, 'PATCH', `/checklist-items/${first.id}`, { dueDate: day(20) }), 403)
  const mine = await hrCall(10, 'GET', '/checklists/mine')
  assert.ok(mine.some((m) => m.itemId === first.id && m.personName === 'Жуков Лев' && !m.done))
  assert.ok(mine.every((m) => !('assignee' in m)))
  const done1 = await hrCall(10, 'PATCH', `/checklist-items/${first.id}`, { done: true, note: 'сделано' })
  assert.equal(done1.done, true)
  assert.equal(done1.doneBy, 'Кравцов Денис')
  assert.ok(done1.doneAt)
  assert.equal((await hrCall(9, 'PATCH', `/checklist-items/${first.id}`, { done: false })).doneAt, null)
  await hrCall(10, 'PATCH', `/checklist-items/${first.id}`, { done: true })

  // последний пункт -> статус done и уведомление всем HR (не обычным сотрудникам)
  for (const item of c.items.slice(1)) await hrCall(9, 'PATCH', `/checklist-items/${item.id}`, { done: true })
  assert.equal((await hrCall(9, 'GET', '/people/12/checklists'))[0].status, 'done')
  for (const token of [9, 13]) {
    const [n] = await inbox(token, 'checklist_done')
    assert.ok(n, `HR ${token} уведомлён`)
    assert.match(n.body, /Жуков Лев/)
  }
  assert.equal((await inbox(3, 'checklist_done')).length, 0)
  assert.equal((await inbox(9, 'checklist_done')).length, 1)
  // завершённый чек-лист изменить и закрыть нельзя
  await rejects(hrCall(9, 'PATCH', `/checklist-items/${first.id}`, { done: false }), 409)
  await rejects(hrCall(9, 'POST', `/checklists/${c.id}/close`), 409)
  assert.equal((await hrCall(10, 'GET', '/checklists/mine')).some((m) => m.itemId === first.id), false, 'закрытые не показываются')
})

test('чек-листы: закрыть и отменить, права и 404', async () => {
  const { hrCall } = setup()
  const [onboarding] = await hrCall(9, 'GET', '/checklist-templates')
  const a = await hrCall(9, 'POST', '/people/14/checklists', { templateId: onboarding.id })
  const b = await hrCall(9, 'POST', '/people/14/checklists', { templateId: onboarding.id })
  await rejects(hrCall(3, 'POST', `/checklists/${a.id}/close`), 403)
  await rejects(hrCall(9, 'POST', '/checklists/9999/close'), 404)
  assert.equal((await hrCall(9, 'POST', `/checklists/${a.id}/close`)).status, 'done')
  assert.equal((await hrCall(9, 'POST', `/checklists/${b.id}/cancel`)).status, 'cancelled')
  await rejects(hrCall(9, 'POST', `/checklists/${b.id}/cancel`), 409)
  await rejects(hrCall(9, 'PATCH', `/checklist-items/${b.items[0].id}`, { done: true }), 409)
  const list = await hrCall(9, 'GET', '/people/14/checklists')
  assert.deepEqual(list.map((c) => c.status).sort(), ['cancelled', 'done'])
  assert.equal(a.items.every((i) => !i.done), true, 'закрытие не отмечает пункты')
})

test('экспорт сотрудников: только Hr, валидный xlsx без денег и документов', async () => {
  const { hrCall, call } = setup()
  await rejects(hrCall(3, 'GET', '/export/people'), 403)
  await call(9, 'PATCH', '/modules/team/hr/people/12', { isArchived: true })
  await hrCall(13, 'PATCH', '/people/12/sensitive', { salary: 777777, passport: 'AB 1234567' })
  const out = await hrCall(9, 'GET', '/export/people')
  assert.deepEqual(Object.keys(out).sort(), ['dataBase64', 'fileName'])
  assert.equal(out.fileName, `people_${today}.xlsx`)
  const sheets = readSheets(out.dataBase64)
  const rows = sheets['Сотрудники']
  assert.deepEqual(rows[0], ['ФИО', 'Должность', 'Направление', 'Руководитель', 'Статус', 'Страна', 'Дата приёма', 'Заполнено, %', 'Почта', 'Telegram', 'Локация', 'Формат работы'])
  const zhukov = rows.find((r) => r[0] === 'Жуков Лев')
  assert.deepEqual([zhukov[4], zhukov[5], zhukov[6]], ['Уволен', 'Россия', '03.02.2025'])
  assert.equal(typeof zhukov[7], 'number')
  assert.equal(rows.find((r) => r[0] === 'Громов Павел')[4], 'Работает')
  assert.equal(rows.length, 17, 'заголовок и все 16 карточек, включая уволенных')
  const text = JSON.stringify(sheets)
  assert.equal(text.includes('777777') || text.includes('AB 1234567') || /Оклад|Паспорт|Документ/.test(text), false)
})

test('экспорт отпусков: период, 422, листы «Отпуска» и «Баланс»', async () => {
  const { hrCall } = setup()
  await rejects(hrCall(3, 'GET', `/export/leave?from=${day(0)}&to=${day(30)}`), 403)
  await rejects(hrCall(9, 'GET', '/export/leave'), 422)
  await rejects(hrCall(9, 'GET', `/export/leave?from=${day(10)}&to=${day(1)}`), 422)
  await rejects(hrCall(9, 'GET', '/export/leave?from=2026-02-30&to=2026-03-01'), 422)
  await rejects(hrCall(9, 'GET', `/export/leave?from=${day(0)}&to=${day(400)}`), 422)
  const out = await hrCall(9, 'GET', `/export/leave?from=${day(0)}&to=${day(399)}`)
  assert.equal(out.fileName, `leave_${day(0)}_${day(399)}.xlsx`)
  const sheets = readSheets(out.dataBase64)
  assert.deepEqual(Object.keys(sheets), ['Отпуска', 'Баланс'])
  assert.deepEqual(sheets['Отпуска'][0], ['ФИО', 'Вид', 'С', 'По', 'Дней'])
  // демо: у Ани (+40..+53) и Жукова (учёба +12..+18) согласованные отпуска; прошедший отпуск Ани (-120..-107) вне периода
  const names = sheets['Отпуска'].slice(1).map((r) => r[0])
  assert.deepEqual(names, ['Жуков Лев', 'Саркисян Ани'])
  assert.deepEqual(sheets['Отпуска'][2].slice(1), ['Ежегодный', formatDate(day(40)), formatDate(day(53)), 14])
  assert.deepEqual(sheets['Баланс'][0], ['ФИО', 'Накоплено', 'Использовано', 'Запланировано', 'Доступно'])
  const ani = sheets['Баланс'].find((r) => r[0] === 'Саркисян Ани')
  assert.equal(ani[3], 14)
  assert.equal(sheets['Баланс'].length, 17, 'заголовок и 16 неуволенных карточек')
  // другой период — пустой лист «Отпуска», но с заголовком
  assert.equal(readSheets((await hrCall(9, 'GET', `/export/leave?from=${day(200)}&to=${day(210)}`)).dataBase64)['Отпуска'].length, 1)
})

test('документы: «Показывать сотруднику» при загрузке и через PATCH, только responsible', async () => {
  const { hrCall } = setup()
  const b64 = Buffer.alloc(10, 65).toString('base64')
  const valid = { category: 'contract', title: 'Договор', fileName: 'a.pdf', dataBase64: b64 }
  const seeded = await hrCall(13, 'GET', '/people/11/documents')
  assert.deepEqual(seeded.map((d) => d.visibleToEmployee), [true, false])
  await rejects(hrCall(13, 'POST', '/people/14/documents', { ...valid, visibleToEmployee: 'yes' }), 422)
  const hidden = await hrCall(13, 'POST', '/people/14/documents', valid)
  assert.equal(hidden.visibleToEmployee, false)
  const shown = await hrCall(13, 'POST', '/people/14/documents', { ...valid, visibleToEmployee: true })
  assert.equal(shown.visibleToEmployee, true)

  await rejects(hrCall(9, 'PATCH', `/documents/${hidden.id}`, { visibleToEmployee: true }), 403)
  await rejects(hrCall(13, 'PATCH', '/documents/9999', { visibleToEmployee: true }), 404)
  await rejects(hrCall(13, 'PATCH', `/documents/${hidden.id}`, { visibleToEmployee: 1 }), 422)
  await rejects(hrCall(13, 'PATCH', `/documents/${hidden.id}`, { category: 'zzz' }), 422)
  await rejects(hrCall(13, 'PATCH', `/documents/${hidden.id}`, { title: ' ' }), 422)
  const patched = await hrCall(13, 'PATCH', `/documents/${hidden.id}`, { visibleToEmployee: true, title: 'Новый договор' })
  assert.deepEqual([patched.visibleToEmployee, patched.title, patched.category], [true, 'Новый договор', 'contract'])
  assert.equal(patched.dataBase64, undefined)
  assert.equal((await hrCall(13, 'GET', '/people/14/documents')).find((d) => d.id === hidden.id).visibleToEmployee, true)
  assert.equal((await hrCall(13, 'PATCH', `/documents/${hidden.id}`, { visibleToEmployee: false })).visibleToEmployee, false)
})

test('обзор чек-листов: Hr, фильтр статуса, прогресс и просрочка, сортировка', async () => {
  const { hrCall } = setup()
  await rejects(hrCall(3, 'GET', '/checklists'), 403)
  await rejects(hrCall(9, 'GET', '/checklists?status=zzz'), 422)
  const [onboarding] = await hrCall(9, 'GET', '/checklist-templates')
  const fresh = await hrCall(9, 'POST', '/people/14/checklists', { templateId: onboarding.id, startedAt: day(0) }) // сроки сегодня и позже: не просрочены
  const list = await hrCall(9, 'GET', '/checklists')
  assert.deepEqual(Object.keys(list[0]).sort(), ['id', 'kind', 'overdue', 'personId', 'personName', 'progress', 'startedAt', 'status', 'title'])
  assert.equal(list[0].personName, 'Захарова Полина')
  assert.deepEqual([list[0].progress, list[0].overdue], [{ done: 2, total: 6 }, 4], 'демо: два выполнены, четыре просрочены')
  assert.equal(list[1].id, fresh.id)
  assert.equal(list[1].overdue, 0)
  await hrCall(9, 'POST', `/checklists/${fresh.id}/cancel`)
  assert.equal((await hrCall(9, 'GET', '/checklists')).length, 1)
  assert.deepEqual((await hrCall(9, 'GET', '/checklists?status=cancelled')).map((c) => c.id), [fresh.id])
  assert.equal((await hrCall(9, 'GET', '/checklists?status=all')).length, 2)
  assert.equal((await hrCall(9, 'GET', '/checklists?status=done')).length, 0)
})
