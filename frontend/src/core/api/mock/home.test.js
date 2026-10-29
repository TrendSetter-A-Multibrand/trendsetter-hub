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
