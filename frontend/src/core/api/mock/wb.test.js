import test from 'node:test'
import assert from 'node:assert/strict'

// client.js -> session.js работает с sessionStorage — в Node его нет
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

const { ApiError } = await import('../client.js')
const { createWbHandlers } = await import('./wb.js')
const { createMockTransport } = await import('./transport.js')

const ACCESS = { 'mock:run': 'run', 'mock:view': 'view', 'mock:none': 'none' }
const userFromToken = (token) => {
  if (!token) throw new ApiError(401, 'unauthorized')
  return { token }
}
const transport = createMockTransport(
  createWbHandlers({ userFromToken, accessTo: (u) => ACCESS[u.token], now: () => new Date('2026-10-27T10:00:00') }).handlers,
)
const get = (from, to, token = 'mock:run') => transport({ method: 'GET', path: `/modules/wb/marking?from=${from}&to=${to}`, token })
const save = (body, token = 'mock:run') => transport({ method: 'POST', path: '/modules/wb/marking/document', body, token })

test('права: данные — view/run, документ — только run', async () => {
  await assert.rejects(get('2026-10-19', '2026-10-24', 'mock:none'), (e) => e.status === 403)
  const out = await get('2026-10-19', '2026-10-24', 'mock:view')
  assert.ok(out.items.length > 0)
  await assert.rejects(save({ key: out.items[0].key, document: '1' }, 'mock:view'), (e) => e.status === 403)
})

test('период: дни только из периода и не позже вчера; неверный период — 422', async () => {
  const out = await get('2026-10-24', '2026-10-30')
  assert.ok(out.items.every((it) => it.date >= '2026-10-24' && it.date <= '2026-10-26'))
  await assert.rejects(get('2026-10-24', '2026-10-19'), (e) => e.status === 422)
  await assert.rejects(get('2026-07-31', '2026-08-05'), (e) => e.status === 422)
  assert.ok((await get('2026-08-01', '2026-10-26')).items.length > 0)
})

test('документ сохраняется и снимается', async () => {
  const item = (await get('2026-10-20', '2026-10-20')).items.find((it) => it.list === 'withdraw')
  await save({ key: item.key, document: ' 30/17-09-26 ' })
  const find = async () => (await get('2026-10-20', '2026-10-20')).items.find((it) => it.key === item.key)
  assert.equal((await find()).document, '30/17-09-26')
  await save({ key: item.key, document: '' })
  assert.equal((await find()).document, '')
  await assert.rejects(save({ key: 'strange:x:y', document: '1' }), (e) => e.status === 422)
})

test('загрузка из Excel: номер по коду, ручной номер важнее', async () => {
  const item = (await get('2026-10-21', '2026-10-21')).items.find((it) => it.list === 'withdraw')
  const res = await transport({ method: 'POST', path: '/modules/wb/marking/import', token: 'mock:run', body: { list: 'withdraw', rows: [{ km: item.km, document: '7/21-10-26' }, { km: 'x', document: '1' }] } })
  assert.deepEqual(res, { saved: 1, skipped: 1 })
  const find = async () => (await get('2026-10-21', '2026-10-21')).items.find((it) => it.key === item.key)
  assert.equal((await find()).document, '7/21-10-26')
  await save({ key: item.key, document: '8/21-10-26' })
  assert.equal((await find()).document, '8/21-10-26')
})
