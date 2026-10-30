import test from 'node:test'
import assert from 'node:assert/strict'
import { applyWidgetConfig, orderWidgets } from './widgetConfig.js'

const W = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
const ids = (list) => list.map((w) => w.id)

test('нет настройки (null) — виджеты как есть', () => {
  assert.equal(applyWidgetConfig(W, null), W)
})

test('пустая настройка — порядок по умолчанию, всё включено', () => {
  assert.deepEqual(ids(applyWidgetConfig(W, [])), ['a', 'b', 'c'])
})

test('порядок берётся из настройки', () => {
  const config = [{ id: 'c', enabled: true }, { id: 'a', enabled: true }, { id: 'b', enabled: true }]
  assert.deepEqual(ids(applyWidgetConfig(W, config)), ['c', 'a', 'b'])
})

test('неизвестные id и повторы пропускаются', () => {
  const config = [{ id: 'zzz', enabled: true }, { id: 'b', enabled: true }, { id: 'b', enabled: false }]
  assert.deepEqual(ids(applyWidgetConfig(W, config)), ['b', 'a', 'c'])
})

test('виджеты, которых нет в настройке, идут в конце в порядке по умолчанию', () => {
  assert.deepEqual(ids(applyWidgetConfig(W, [{ id: 'c', enabled: true }])), ['c', 'a', 'b'])
})

test('выключенные убираются, а ненастроенные новые остаются включёнными', () => {
  const config = [{ id: 'b', enabled: false }, { id: 'a', enabled: true }]
  assert.deepEqual(ids(applyWidgetConfig(W, config)), ['a', 'c'])
})

test('все выключены — пустой список', () => {
  assert.deepEqual(applyWidgetConfig(W, [{ id: 'a', enabled: false }, { id: 'b', enabled: false }, { id: 'c', enabled: false }]), [])
})

test('orderWidgets оставляет выключенные с признаком enabled', () => {
  const out = orderWidgets(W, [{ id: 'b', enabled: false }])
  assert.deepEqual(out.map((w) => [w.id, w.enabled]), [['b', false], ['a', true], ['c', true]])
})
