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
