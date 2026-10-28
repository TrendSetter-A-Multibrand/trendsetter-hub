import test from 'node:test'
import assert from 'node:assert/strict'
import { SLICE_COLORS, donutArcs, formatTenure, pct, toDonutItems } from './stats.js'

const row = (label, count) => ({ label, count })

test('toDonutItems: нули отброшены, до 6 секторов без «Другие»', () => {
  const out = toDonutItems([row('А', 5), row('Б', 0), row('В', 2)], (i) => i.label)
  assert.deepEqual(out, [{ label: 'А', value: 5 }, { label: 'В', value: 2 }])
  const six = toDonutItems(['а', 'б', 'в', 'г', 'д', 'е'].map((l) => row(l, 1)), (i) => i.label)
  assert.equal(six.length, 6)
  assert.ok(six.every((i) => i.rest === undefined))
})

test('toDonutItems: хвост сверх max-1 схлопывается в «Другие» с верной суммой', () => {
  const items = [10, 9, 8, 7, 6, 5, 4].map((n, i) => row(`Л${i}`, n))
  const out = toDonutItems(items, (i) => i.label)
  assert.equal(out.length, 6)
  assert.deepEqual(out.slice(0, 5).map((i) => i.value), [10, 9, 8, 7, 6])
  assert.equal(out[5].value, 9)
  assert.equal(out[5].rest, 2)
  assert.equal(out.reduce((s, i) => s + i.value, 0), 49)
})

test('pct: целый процент, ноль при пустой сумме', () => {
  assert.equal(pct(1, 3), 33)
  assert.equal(pct(2, 3), 67)
  assert.equal(pct(5, 0), 0)
})

test('formatTenure', () => {
  assert.equal(formatTenure(0), '0 мес.')
  assert.equal(formatTenure(8), '8 мес.')
  assert.equal(formatTenure(12), '1 г.')
  assert.equal(formatTenure(29), '2 г. 5 мес.')
  assert.equal(formatTenure(60), '5 г.')
})

test('donutArcs: смещения монотонны, доли дают 1, «Другие» серые', () => {
  const arcs = donutArcs([{ label: 'а', value: 3 }, { label: 'б', value: 1 }, { label: 'в', value: 2 }, { label: 'Другие', value: 4, rest: 2 }], 120)
  for (let i = 1; i < arcs.length; i++) assert.ok(arcs[i].offset > arcs[i - 1].offset)
  assert.ok(Math.abs(arcs.reduce((s, a) => s + a.share, 0) - 1) < 1e-9)
  assert.ok(Math.abs(arcs.reduce((s, a) => s + a.length, 0) - arcs[0].circumference) < 1e-9)
  assert.equal(arcs[3].color, SLICE_COLORS[5])
  assert.equal(arcs[0].offset, 0)
})
