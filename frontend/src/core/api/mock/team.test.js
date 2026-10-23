import test from 'node:test'
import assert from 'node:assert/strict'

// client.js -> session.js работает с sessionStorage — в Node его нет
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

const { computeModuleAccess } = await import('../../access.js')
const { data: hub } = await import('./data.js')
const { createTeamHandlers } = await import('./team.js')
const { createMockTransport } = await import('./transport.js')

// token = id пользователя из демо-данных: 1 admin, 3 сотрудник закупок, 5 viewer, 6 без карточки, 8 с отклонённой заявкой, 9 HR
const userFromToken = (token) => hub.users.find((u) => u.id === Number(token))
const accessTo = (user, id) => computeModuleAccess(user, hub.moduleDepartments[id] ?? [], [], id === 'team')

function setup() {
  const { handlers, moduleBadges } = createTeamHandlers({ userFromToken, accessTo })
  const transport = createMockTransport(handlers)
  const call = (token, method, path, body) => transport({ method, path: `/modules/team${path}`, body, token })
  return { call, moduleBadges }
}

const rejects = (promise, status) => assert.rejects(promise, (e) => e.status === status)

// минимальный JPEG-заголовок + падding до нужного размера
const jpeg = (bytes) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(bytes - 4)]).toString('base64')}`
const photo = { full: jpeg(1000), thumb: jpeg(500) }

const fullValues = {
  first_name: 'Тест', last_name: 'Тестов', title: 'Тестировщик', manager_claim: 'Громов', responsibility: 'Проверки',
  ask_me_about: 'Тесты', location: 'Москва', work_format: 'Гибрид', telegram: '@tester', hobbies: ['Чай'],
}

test('/map: сотрудник видит анкету и превью, viewer — только структуру', async () => {
  const { call } = setup()
  const full = await call(3, 'GET', '/map')
  assert.ok(full.people.length >= 14)
  assert.ok(full.people.every((p) => p.id !== 16), 'скрытый (show_in_map=false) не виден')
  assert.ok('telegram' in full.people.find((p) => p.id === 3))
  const slim = await call(5, 'GET', '/map')
  assert.deepEqual(Object.keys(slim.people[0]).sort(), ['directionId', 'id', 'isAssistant', 'isCeo', 'managerId', 'name', 'title'])
  await rejects(call(5, 'GET', '/fields'), 403)
  await rejects(call(5, 'GET', '/people/3/photo'), 403)
  await rejects(call(5, 'GET', '/me'), 403)
  assert.match((await call(3, 'GET', '/people/3/photo')).data, /^data:/)
  await rejects(call(3, 'GET', '/people/4/photo'), 404)
})

test('HR-эндпоинты: 403 для не-HR, бейдж только у HR', async () => {
  const { call, moduleBadges } = setup()
  await rejects(call(3, 'GET', '/hr/people'), 403)
  await rejects(call(5, 'GET', '/hr/pending-count'), 403)
  assert.deepEqual(await call(9, 'GET', '/hr/pending-count'), { count: 2 })
  assert.deepEqual(moduleBadges(userFromToken(9)), { hr: 2 })
  assert.deepEqual(moduleBadges(userFromToken(1)), { hr: 2 })
  assert.deepEqual(moduleBadges(userFromToken(3)), {})
})

test('заявка: одна pending, фото обязательно, JPEG и лимиты, PATCH и cancel', async () => {
  const { call } = setup()
  await rejects(call(6, 'POST', '/me/submission', { values: fullValues, photo }), 409) // у 6 уже есть pending
  await call(6, 'POST', '/me/submission/cancel')
  await rejects(call(6, 'POST', '/me/submission', { values: fullValues, photo: null }), 422) // фото обязательно
  await rejects(call(6, 'POST', '/me/submission', { values: { ...fullValues, hobbies: [] }, photo }), 422) // обязательное поле
  await rejects(call(6, 'POST', '/me/submission', { values: fullValues, photo: { full: 'data:image/jpeg;base64,AAAAAAAAAAAA', thumb: photo.thumb } }), 422) // нет FF D8 FF
  await rejects(call(6, 'POST', '/me/submission', { values: fullValues, photo: { full: jpeg(300 * 1024 + 10), thumb: photo.thumb } }), 422)
  await rejects(call(6, 'POST', '/me/submission', { values: fullValues, photo: { full: photo.full, thumb: jpeg(30 * 1024 + 10) } }), 422)
  const created = await call(6, 'POST', '/me/submission', { values: fullValues, photo })
  assert.equal(created.status, 'pending')
  const me = await call(6, 'GET', '/me')
  assert.equal(me.values.telegram, 'tester')
  assert.equal(me.submission.status, 'pending')
  await call(6, 'PATCH', '/me/submission', { values: { ...fullValues, title: 'Новая должность' }, photo: null })
  assert.equal((await call(6, 'GET', '/me')).values.title, 'Новая должность')
  await call(6, 'POST', '/me/submission/cancel')
  await rejects(call(6, 'PATCH', '/me/submission', { values: fullValues }), 404)
})

test('одобрение: нужна карточка/направление/руководитель, карта обновляется, 409 повторно', async () => {
  const { call } = setup()
  const before = (await call(1, 'GET', '/map')).people.length
  await rejects(call(1, 'POST', '/hr/submissions/1/approve', { directionId: 'ops' }), 422) // без managerId
  await rejects(call(1, 'POST', '/hr/submissions/1/approve', { directionId: 'nope', managerId: 3 }), 422)
  const person = await call(1, 'POST', '/hr/submissions/1/approve', { directionId: 'ops', managerId: 3, tag: 'WB' })
  assert.equal(person.name, 'Саакян Нелли')
  assert.equal(person.userId, 6)
  assert.equal(person.hasPhoto, true)
  assert.equal((await call(1, 'GET', '/map')).people.length, before + 1)
  await rejects(call(1, 'POST', '/hr/submissions/1/approve', { directionId: 'ops', managerId: 3 }), 409)
  // правка существующей карточки: карта хранит старую версию до одобрения
  assert.equal((await call(1, 'GET', '/map')).people.find((p) => p.id === 11).title, 'Менеджер по закупкам')
  await call(1, 'POST', '/hr/submissions/2/approve', {})
  assert.equal((await call(1, 'GET', '/map')).people.find((p) => p.id === 11).title, 'Старший менеджер по закупкам')
  assert.deepEqual(await call(1, 'GET', '/hr/pending-count'), { count: 0 })
})

test('отклонение: причина обязательна, сотрудник её видит', async () => {
  const { call } = setup()
  await rejects(call(1, 'POST', '/hr/submissions/1/reject', { comment: '  ' }), 422)
  await rejects(call(1, 'POST', '/hr/submissions/1/reject', { comment: 'x'.repeat(501) }), 422)
  await call(1, 'POST', '/hr/submissions/1/reject', { comment: 'Нужно фото' })
  assert.equal((await call(6, 'GET', '/me')).submission.reviewComment, 'Нужно фото')
  await rejects(call(1, 'POST', '/hr/submissions/1/reject', { comment: 'ещё раз' }), 409)
  assert.equal((await call(8, 'GET', '/me')).submission.status, 'rejected')
})

test('иерархия: цикл 422, CEO заблокирован, архив с подчинёнными', async () => {
  const { call } = setup()
  await rejects(call(1, 'PATCH', '/hr/people/3', { managerId: 6 }), 422) // 6 — подчинённый 3
  await rejects(call(1, 'PATCH', '/hr/people/3', { managerId: 3 }), 422)
  await rejects(call(1, 'PATCH', '/hr/people/1', { isArchived: true }), 422)
  await rejects(call(1, 'PATCH', '/hr/people/1', { managerId: 3 }), 422)
  await rejects(call(1, 'PATCH', '/hr/people/3', { isArchived: true }), 409)
  await rejects(call(1, 'PATCH', '/hr/people/3', { isArchived: true, reassignTo: 4 }), 422) // 4 в ветке 3
  const done = await call(1, 'PATCH', '/hr/people/3', { isArchived: true, reassignTo: 7 })
  assert.equal(done.isArchived, true)
  const map = await call(1, 'GET', '/map')
  assert.ok(!map.people.some((p) => p.id === 3))
  assert.equal(map.people.find((p) => p.id === 4).managerId, 7)
  // откат атомарный: после ошибки изменения не сохраняются
  await rejects(call(1, 'PATCH', '/hr/people/5', { title: 'Новый', managerId: 999 }), 422)
  assert.equal((await call(1, 'GET', '/map')).people.find((p) => p.id === 5).title, 'Старший кладовщик')
})

test('HR создаёт человека, скрывает и возвращает в карту', async () => {
  const { call } = setup()
  await rejects(call(1, 'POST', '/hr/people', { firstName: 'А', lastName: 'Б', title: 'В', directionId: 'ops', managerId: null }), 422)
  await rejects(call(1, 'POST', '/hr/people', { firstName: 'А', lastName: 'Б', title: 'В', directionId: 'ops', managerId: 3, userId: 3 }), 409) // у user 3 уже есть карточка
  const p = await call(1, 'POST', '/hr/people', { firstName: 'Нина', lastName: 'Новикова', title: 'Тест', directionId: 'buy', managerId: 10, userId: 6 })
  assert.ok((await call(1, 'GET', '/map')).people.some((x) => x.id === p.id))
  await call(1, 'PATCH', `/hr/people/${p.id}`, { showInMap: false })
  assert.ok(!(await call(1, 'GET', '/map')).people.some((x) => x.id === p.id))
  assert.ok((await call(1, 'GET', '/hr/people')).some((x) => x.id === p.id))
  const users = await call(1, 'GET', '/hr/users')
  assert.equal(users.find((u) => u.id === 6).personId, p.id)
})

test('конструктор: ключ, дубль, системные поля, reorder, скрытие', async () => {
  const { call } = setup()
  await rejects(call(1, 'POST', '/hr/fields', { key: 'Bad', label: 'x', kind: 'text' }), 422)
  await rejects(call(1, 'POST', '/hr/fields', { key: 'telegram', label: 'x', kind: 'text' }), 409)
  await rejects(call(1, 'POST', '/hr/fields', { key: 'my_photo', label: 'x', kind: 'photo' }), 422)
  const f = await call(1, 'POST', '/hr/fields', { key: 'pets', label: 'Питомцы', kind: 'chips', required: true })
  assert.equal(f.isSystem, false)
  assert.ok((await call(3, 'GET', '/fields')).some((x) => x.key === 'pets'))
  await rejects(call(1, 'PATCH', '/hr/fields/2', { active: false }), 422) // системное
  await rejects(call(1, 'PATCH', `/hr/fields/${f.id}`, { key: 'other' }), 422)
  await rejects(call(1, 'PATCH', `/hr/fields/${f.id}`, { kind: 'text' }), 422)
  await call(1, 'PATCH', `/hr/fields/${f.id}`, { label: 'Домашние питомцы', active: false })
  assert.ok(!(await call(3, 'GET', '/fields')).some((x) => x.key === 'pets'))
  assert.ok((await call(1, 'GET', '/hr/fields')).some((x) => x.key === 'pets'))
  const order = (await call(1, 'GET', '/hr/fields')).map((x) => x.id).reverse()
  const reordered = await call(1, 'PATCH', '/hr/fields/reorder', { ids: order })
  assert.deepEqual(reordered.map((x) => x.id), order)
})

test('extra: ответы на активные несистемные поля; у structure extra нет', async () => {
  const { call } = setup()
  const gromov = (await call(3, 'GET', '/map')).people.find((p) => p.id === 3)
  assert.deepEqual(gromov.extra, []) // socials в extra не дублируется
  assert.equal(gromov.socials.length, 1)
  assert.deepEqual((await call(3, 'GET', '/map')).people.find((p) => p.id === 4).extra, []) // пустые пропускаются
  const f = await call(1, 'POST', '/hr/fields', { key: 'pets', label: 'Питомцы', kind: 'chips' })
  await call(1, 'PATCH', '/hr/people/4', { values: { pets: ['Кот'] } })
  assert.deepEqual((await call(3, 'GET', '/map')).people.find((p) => p.id === 4).extra, [{ key: 'pets', label: 'Питомцы', kind: 'chips', value: ['Кот'] }])
  await call(1, 'PATCH', `/hr/fields/${f.id}`, { active: false }) // скрытое поле в extra не попадает
  assert.deepEqual((await call(3, 'GET', '/map')).people.find((p) => p.id === 4).extra, [])
  assert.ok('extra' in (await call(1, 'GET', '/hr/people')).find((p) => p.id === 4))
  assert.equal('extra' in (await call(5, 'GET', '/map')).people[0], false)
})

test('/hr/directions: все направления, только HR', async () => {
  const { call } = setup()
  await rejects(call(3, 'GET', '/hr/directions'), 403)
  await rejects(call(5, 'GET', '/hr/directions'), 403)
  const dirs = await call(9, 'GET', '/hr/directions')
  assert.deepEqual(dirs.map((d) => d.id), ['leadership', 'ops', 'mkt', 'buy', 'hr'])
  assert.deepEqual(Object.keys(dirs[0]).sort(), ['avatarInk', 'color', 'id', 'label', 'shortName'])
})

test('сценарий анкеты: отправка -> одобрение -> /me и карта; отклонение -> причина -> повторная отправка', async () => {
  const { call } = setup()
  await call(6, 'POST', '/me/submission/cancel')
  const me0 = await call(6, 'GET', '/me')
  assert.equal(me0.person, null)
  assert.equal(me0.submission, null)
  await call(6, 'POST', '/me/submission', { values: { ...fullValues, first_name: 'Нелли', last_name: 'Саакян' }, photo })
  assert.deepEqual(await call(9, 'GET', '/hr/pending-count'), { count: 2 })
  const [sub] = (await call(9, 'GET', '/hr/submissions?status=pending')).filter((x) => x.userId === 6)
  await call(9, 'POST', `/hr/submissions/${sub.id}/reject`, { comment: 'Нужно другое фото' })
  const rejected = await call(6, 'GET', '/me')
  assert.equal(rejected.submission.status, 'rejected')
  assert.equal(rejected.submission.reviewComment, 'Нужно другое фото')
  assert.equal(rejected.values.telegram, 'tester') // форма предзаполнена отклонённой анкетой
  assert.match(rejected.photo, /^data:image\/jpeg/) // фото отклонённой заявки тоже предзаполнено
  await call(6, 'POST', '/me/submission', { values: fullValues, photo: null }) // фото берётся из отклонённой заявки; повторная отправка после отклонения
  const again = (await call(9, 'GET', '/hr/submissions?status=pending')).find((x) => x.userId === 6)
  const person = await call(9, 'POST', `/hr/submissions/${again.id}/approve`, { directionId: 'ops', managerId: 3 })
  assert.ok((await call(3, 'GET', '/map')).people.some((p) => p.id === person.id))
  const me1 = await call(6, 'GET', '/me')
  assert.equal(me1.person.id, person.id)
  assert.equal(me1.submission.status, 'approved')
})

test('firstName/lastName есть в PersonHr и PersonOwn', async () => {
  const { call } = setup()
  const hr = (await call(9, 'GET', '/hr/people')).find((p) => p.id === 3)
  assert.equal(hr.firstName, 'Павел')
  assert.equal(hr.lastName, 'Громов')
  const own = (await call(3, 'GET', '/me')).person
  assert.equal(own.firstName, 'Ани')
  assert.equal(own.lastName, 'Саркисян')
  assert.equal('firstName' in (await call(3, 'GET', '/map')).people[0], false)
})
