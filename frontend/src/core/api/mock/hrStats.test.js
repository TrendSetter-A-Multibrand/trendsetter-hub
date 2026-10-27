import test from 'node:test'
import assert from 'node:assert/strict'

// client.js -> session.js работает с sessionStorage — в Node его нет
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

const { computeModuleAccess } = await import('../../access.js')
const { data: hub } = await import('./data.js')
const { createTeamHandlers } = await import('./team.js')
const { createHrHandlers } = await import('./hr.js')
const { createHrStatsHandlers, computeStats } = await import('./hrStats.js')
const { createMockTransport } = await import('./transport.js')
const { addDays, todayIso } = await import('../../dates.js')
const { ApiError } = await import('../client.js')

// token = id пользователя: 3 Ани (карточка 11, без права на hr), 9 HR (run, карточка 14)
const userFromToken = (token) => hub.users.find((u) => u.id === Number(token))
const personal = (user, id) => [hub.userModulePermissions[user.id]?.[id]].filter(Boolean)
const accessTo = (user, id) => computeModuleAccess(user, hub.moduleDepartments[id] ?? [], personal(user, id), id === 'team')

function setup() {
  const team = createTeamHandlers({ userFromToken, accessTo })
  const hr = createHrHandlers({ userFromToken, accessTo, isResponsible: () => false, team, notify: () => {} })
  const stats = createHrStatsHandlers({ userFromToken, accessTo, team, hr })
  const transport = createMockTransport({ ...team.handlers, ...hr.handlers, ...stats.handlers })
  return { team, hr, get: (token) => transport({ method: 'GET', path: '/modules/hr/stats', token }) }
}

const today = todayIso()
const person = (id, extra = {}) => ({
  id, lastName: `Фамилия${id}`, firstName: `Имя${id}`, managerId: null, directionId: 'ops', userId: null, team: null,
  showInMap: true, isArchived: false, answers: {}, ...extra,
})
const dirs = [{ id: 'ops', sort: 1 }]
const compute = (over) => computeStats({ people: [], directions: dirs, files: {}, requests: [], fields: [], today, ...over })
const sum = (buckets) => buckets.reduce((a, b) => a + b.count, 0)

test('права: 403 без run на hr, 200 для HR', async () => {
  const { get } = setup()
  await assert.rejects(get(3), (e) => e instanceof ApiError && e.status === 403)
  const s = await get(9)
  assert.equal(s.asOf, today)
})

test('демо: сумма групп равна known, несколько групп возраста и стажа, скрытые из карты входят', async () => {
  const { get, team } = setup()
  const s = await get(9)
  assert.equal(sum(s.age.buckets), s.age.known)
  assert.equal(sum(s.tenure.buckets), s.tenure.known)
  assert.ok(s.age.buckets.filter((b) => b.count > 0).length >= 3)
  assert.ok(s.tenure.buckets.filter((b) => b.count > 0).length >= 3)
  assert.ok(s.age.known < s.total, 'у части людей досье нет')
  assert.equal(s.total, team.people().filter((p) => !p.isArchived).length)
  assert.equal(s.hiddenFromMap, 1)
  assert.ok(s.gender.known > 0 && s.gender.known < s.total)
  assert.ok(s.age.average !== null && s.tenure.averageMonths !== null)
})

test('в ответе нет дат рождения, денег и ключей досье', async () => {
  const { get, hr } = setup()
  const s = await get(9)
  const json = JSON.stringify(s)
  for (const key of ['birthDate', 'salary', 'currency', 'passport']) assert.ok(!json.includes(`"${key}"`), key)
  for (const f of Object.values(hr.store.files())) if (f.birthDate) assert.ok(!json.includes(f.birthDate), f.birthDate)
})

test('архивные не входят в охват, а уволенные за 90 дней считаются', () => {
  const people = [person(1), person(2), person(3, { isArchived: true }), person(4, { isArchived: true })]
  const files = {
    3: { birthDate: '1990-01-01', hiredAt: '2020-01-01', country: 'RU', dismissedAt: addDays(today, -10) },
    4: { dismissedAt: addDays(today, -91) },
  }
  const s = compute({ people, files })
  assert.equal(s.total, 2)
  assert.equal(s.age.known, 0)
  assert.equal(s.tenure.known, 0)
  assert.equal(s.country.known, 0)
  assert.equal(s.dismissed.count, 1)
})

test('средние только при known >= 3', () => {
  const people = [person(1), person(2), person(3)]
  const file = (n) => ({ birthDate: `${Number(today.slice(0, 4)) - 30 - n}-01-01`, hiredAt: addDays(today, -400 - n) })
  const two = compute({ people, files: { 1: file(0), 2: file(1) } })
  assert.equal(two.age.average, null)
  assert.equal(two.tenure.averageMonths, null)
  const three = compute({ people, files: { 1: file(0), 2: file(1), 3: file(2) } })
  assert.equal(typeof three.age.average, 'number')
  assert.equal(typeof three.tenure.averageMonths, 'number')
})

test('больничные и неодобренные не попадают в списки отпусков', () => {
  const people = [person(1), person(2), person(3), person(4)]
  const req = (id, personId, over) => ({ id, personId, kind: 'annual', status: 'approved', start: today, end: addDays(today, 3), ...over })
  const s = compute({
    people,
    requests: [req(1, 1, {}), req(2, 2, { kind: 'sick' }), req(3, 3, { status: 'pending' }), req(4, 4, { start: addDays(today, 14), end: addDays(today, 20) })],
  })
  assert.deepEqual(s.leave.now.map((l) => l.personId), [1])
  assert.deepEqual(s.leave.soon.map((l) => l.personId), [4])
})

test('location: регистр и пробелы схлопываются, подпись — вариант поля', () => {
  const people = ['москва ', 'Москва', 'МОСКВА', '', 'Ереван'].map((location, i) => person(i + 1, { answers: { location } }))
  const s = compute({ people, fields: [{ key: 'location', options: ['Москва', 'Ереван'] }] })
  assert.deepEqual(s.location, { known: 4, items: [{ label: 'Москва', count: 3 }, { label: 'Ереван', count: 1 }] })
})
