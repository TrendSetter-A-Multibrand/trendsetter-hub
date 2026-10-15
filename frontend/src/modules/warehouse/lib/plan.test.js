import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPlan, route, guess, routeMarked, markedMap } from './plan.js'

const KI1 = '0104620270011115215Peib9SE3WkoI'
const KI2 = '0104620270011115216Qwert12345Zz'

const rows = [
  ['Штрихкод', 'Короб', 'Кол-во'],
  ['4600000000011', '5', '2'],
  ['4600000000028', '7', '1'],
  ['4600000000011', '9', '1'],
]

test('guess находит заголовки и столбцы', () => {
  const g = guess(rows)
  assert.equal(g.hdr, 0)
  assert.equal(g.bc, 0)
  assert.equal(g.bx, 1)
  assert.equal(g.q, 2)
})

test('buildPlan: ожидаемые количества и коробки', () => {
  const r = buildPlan({ rows, bc: 0, bx: 1, q: 2, h: 0, kc: -1, name: 'f.xlsx' })
  assert.equal(r.plan.total, 4)
  assert.deepEqual(r.plan.boxes, ['5', '7', '9'])
  assert.equal(r.plan.hasQty, true)
})

test('buildPlan: ошибки', () => {
  assert.equal(buildPlan({ rows, bc: 1, bx: 1, q: -1, h: 0, kc: -1 }).error, 'sameCols')
  assert.equal(buildPlan({ rows: [['a', 'b']], bc: 0, bx: 1, q: -1, h: 0, kc: -1 }).error, 'noLines')
})

test('route: по количеству, затем излишек в коробку 20, неизвестный товар в 20', () => {
  const { plan } = buildPlan({ rows, bc: 0, bx: 1, q: 2, h: 0, kc: -1 })
  const alloc = {}
  const take = (n) => {
    const r = route(plan, alloc, n)
    if (r.status === 'ok') {
      alloc[n] = alloc[n] || {}
      alloc[n][r.box] = (alloc[n][r.box] || 0) + 1
    }
    return r
  }
  const n = '4600000000011'
  assert.deepEqual([take(n).box, take(n).box, take(n).box], ['5', '5', '9'])
  assert.deepEqual(take(n), { box: '20', status: 'extra' })
  assert.deepEqual(take('999'), { box: '20', status: 'unknown' })
})

test('Честный знак: коробка по точному КИ, дубли в файле считаются', () => {
  const r = buildPlan({
    rows: [['Штрихкод', 'Короб', 'КИ'], ['4620270011115', '3', KI1], ['4620270011115', '4', KI2], ['4620270011115', '4', KI1]],
    bc: 0, bx: 1, q: -1, h: 0, kc: 2, name: 'cz.xlsx',
  })
  assert.equal(r.plan.kiCount, 2)
  assert.equal(r.plan.kiDup, 1)
  assert.equal(r.plan.kiMap[KI1], '3')
  assert.equal(r.plan.kiMap[KI2], '4')
})

test('Скан без ЧЗ: маркированный товар по EAN ждём в коробках шаблона', () => {
  const { plan } = buildPlan({
    rows: [['Штрихкод', 'Короб', 'КИ'], ['4620270011115', '3', KI1], ['4620270011115', '3', KI2]],
    bc: 0, bx: 1, q: -1, h: 0, kc: 2,
  })
  const mm = markedMap(plan)
  assert.deepEqual(mm['4620270011115'], [{ box: '3', qty: 2 }])
  assert.equal(routeMarked(plan, {}, '4620270011115').box, '3')
  assert.deepEqual(routeMarked(plan, { '4620270011115': { 3: 2 } }, '4620270011115'), { box: '20', status: 'extra' })
})
