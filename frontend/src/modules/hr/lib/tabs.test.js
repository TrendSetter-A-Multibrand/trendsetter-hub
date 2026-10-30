import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeTabs } from './tabs.js'

const base = [{ key: 'a', group: 'staff' }, { key: 'b', group: 'leave' }, { key: 'audit', group: 'security' }]
const extra = [{ key: 'x', group: 'feedback' }, { key: 'y', group: 'feedback' }]
const keys = (tabs) => tabs.map((t) => t.key)

test('mergeTabs: вставляет extra перед группой security, порядок extra сохраняется', () => {
  assert.deepEqual(keys(mergeTabs(base, extra)), ['a', 'b', 'x', 'y', 'audit'])
})

test('mergeTabs: без security — в конец', () => {
  assert.deepEqual(keys(mergeTabs(base.slice(0, 2), extra)), ['a', 'b', 'x', 'y'])
})

test('mergeTabs: пустой extra — без изменений', () => {
  assert.equal(mergeTabs(base, []), base)
})

test('mergeTabs: исходный массив не меняется', () => {
  mergeTabs(base, extra)
  assert.equal(base.length, 3)
})
