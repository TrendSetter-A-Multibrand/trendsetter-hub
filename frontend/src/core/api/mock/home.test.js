import test from 'node:test'
import assert from 'node:assert/strict'

// client.js -> session.js работает с sessionStorage — в Node его нет
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

const { ApiError } = await import('../client.js')
const { createHomeHandlers } = await import('./home.js')
const { createMockTransport } = await import('./transport.js')
const { todayIso, addDays } = await import('../../dates.js')

const userFromToken = (token) => {
  if (!token) throw new ApiError(401, 'unauthorized')
  return { id: 1 }
}
const call = (path, token = 'mock:1') => createMockTransport(createHomeHandlers({ userFromToken }).handlers)({ method: 'GET', path, token })

test('без токена — 401', async () => {
  await assert.rejects(call('/core/home/weather', null), (e) => e.status === 401)
  await assert.rejects(call('/core/home/rates', null), (e) => e.status === 401)
})

test('погода: 7 дней от сегодня у обоих городов', async () => {
  const out = await call('/core/home/weather')
  assert.deepEqual(out.cities.map((c) => c.id), ['yerevan', 'moscow'])
  const today = todayIso()
  for (const city of out.cities) {
    assert.deepEqual(city.days.map((d) => d.date), Array.from({ length: 7 }, (_, i) => addDays(today, i)))
    assert.ok(city.days.every((d) => d.min < d.max && typeof d.symbol === 'string'))
    assert.equal(city.stale, false)
  }
})

test('погода: ?city — третий город, дефолтные/неизвестные/мусор — 2 города', async () => {
  const ids = async (q) => (await call(`/core/home/weather${q}`)).cities.map((c) => c.id)
  assert.deepEqual(await ids('?city=kazan'), ['yerevan', 'moscow', 'kazan'])
  assert.deepEqual(await ids('?city=moscow'), ['yerevan', 'moscow'])
  assert.deepEqual(await ids('?city=yerevan'), ['yerevan', 'moscow'])
  assert.deepEqual(await ids('?city=zzz'), ['yerevan', 'moscow'])
  assert.deepEqual(await ids('?city='), ['yerevan', 'moscow'])
})

test('погода: ?city=g<id> из справочника — третий город с зоной справочника и слотами; неизвестный g-id — 2 города', async () => {
  const out = await call('/core/home/weather?city=g2643743') // Лондон
  assert.deepEqual(out.cities.map((c) => c.id), ['yerevan', 'moscow', 'g2643743'])
  const london = out.cities[2]
  assert.equal(london.timezone, 'Europe/London')
  assert.deepEqual(london.days[0].slots.map((sl) => sl.id), ['morning', 'noon', 'lunch', 'evening'])
  assert.equal(london.days.length, 7)
  // условная температура для не-легаси городов — из хэша id, в диапазоне от -5 до +30 (с учётом разброса дней)
  assert.ok(london.days.every((d) => d.max >= -10 && d.max <= 35))
  const again = await call('/core/home/weather?city=g2643743')
  assert.deepEqual(again.cities[2].days.map((d) => d.max), london.days.map((d) => d.max))
  for (const q of ['g0', 'G2643743', 'g2643743%20', '__proto__']) {
    assert.deepEqual((await call(`/core/home/weather?city=${q}`)).cities.map((c) => c.id), ['yerevan', 'moscow'], q)
  }
})

test('погода: ?city=dubai по-прежнему работает (прежние 17 городов)', async () => {
  const out = await call('/core/home/weather?city=dubai')
  assert.deepEqual(out.cities.map((c) => c.id), ['yerevan', 'moscow', 'dubai'])
  assert.equal(out.cities[2].timezone, 'Asia/Dubai')
})

test('погода: slots только у days[0], 4 окна по порядку', async () => {
  const out = await call('/core/home/weather?city=dubai')
  for (const city of out.cities) {
    assert.deepEqual(city.days[0].slots.map((sl) => sl.id), ['morning', 'noon', 'lunch', 'evening'])
    assert.ok(city.days.slice(1).every((d) => !('slots' in d)))
    assert.ok(city.days[0].slots.every((sl) => typeof sl.past === 'boolean' && sl.temp !== null))
  }
})

test('курсы: порядок USD, EUR, AMD и номинал AMD', async () => {
  const out = await call('/core/home/rates')
  assert.deepEqual(out.rates.map((r) => r.code), ['USD', 'EUR', 'AMD'])
  assert.equal(out.date, todayIso())
  assert.equal(out.rates[2].nominal, 100)
  assert.equal(out.rates[2].perUnit, 0.223011)
})

// ---- виджеты главной ----

test('виджеты: GET без токена — 401, по умолчанию пусто; POST без права — 403', async () => {
  const denied = createHomeHandlers({ userFromToken, canEditWidgets: () => false }).handlers
  const run = (handlers, method, body, token = 'mock:1') => createMockTransport(handlers)({ method, path: '/core/home/widgets', token, body })
  await assert.rejects(run(denied, 'GET', undefined, null), (e) => e.status === 401)
  assert.deepEqual(await run(denied, 'GET'), { widgets: [] })
  await assert.rejects(run(denied, 'POST', { widgets: [{ id: 'a', enabled: true }] }), (e) => e.status === 403)
})

test('виджеты: POST заменяет всё, GET отдаёт сохранённое, невалидное — 422', async () => {
  const handlers = createHomeHandlers({ userFromToken, canEditWidgets: () => true }).handlers
  const run = (method, body) => createMockTransport(handlers)({ method, path: '/core/home/widgets', token: 'mock:1', body })
  const first = [{ id: 'weather', enabled: true }, { id: 'leave', enabled: false }]
  assert.deepEqual(await run('POST', { widgets: first }), { widgets: first })
  assert.deepEqual(await run('GET'), { widgets: first })
  for (const bad of [[], [{ id: 'a', enabled: true }, { id: 'a', enabled: false }], [{ id: 'Bad', enabled: true }], [{ id: 'a' }], Array.from({ length: 31 }, (_, i) => ({ id: `w${i}`, enabled: true }))]) {
    await assert.rejects(run('POST', { widgets: bad }), (e) => e.status === 422)
  }
  assert.deepEqual(await run('GET'), { widgets: first })
})
