import test from 'node:test'
import assert from 'node:assert/strict'
import { canDeleteHistory, checklistProgress, isEquipmentOverdue, isItemOverdue } from './ops.js'

test('оборудование: просрочено только невозвращённое с прошедшим сроком', () => {
  const today = '2026-10-23'
  assert.equal(isEquipmentOverdue({ returnDue: '2026-10-22', returnedAt: null }, today), true)
  assert.equal(isEquipmentOverdue({ returnDue: '2026-10-23', returnedAt: null }, today), false, 'в день срока ещё не просрочено')
  assert.equal(isEquipmentOverdue({ returnDue: '2026-10-01', returnedAt: '2026-10-05' }, today), false)
  assert.equal(isEquipmentOverdue({ returnDue: null, returnedAt: null }, today), false)
})

test('чек-лист: просроченный пункт и прогресс', () => {
  const today = '2026-10-23'
  assert.equal(isItemOverdue({ dueDate: '2026-10-20', done: false }, today), true)
  assert.equal(isItemOverdue({ dueDate: '2026-10-20', done: true }, today), false)
  assert.equal(isItemOverdue({ dueDate: null, done: false }, today), false)
  assert.deepEqual(checklistProgress([]), { done: 0, total: 0, percent: 0 })
  assert.deepEqual(checklistProgress([{ done: true }, { done: false }, { done: false }]), { done: 1, total: 3, percent: 33 })
  assert.equal(checklistProgress([{ done: true }, { done: true }]).percent, 100)
})

test('история: HR удаляет только ручные не salary, ответственный любые', () => {
  assert.equal(canDeleteHistory({ auto: false, kind: 'other' }, false), true)
  assert.equal(canDeleteHistory({ auto: true, kind: 'position' }, false), false)
  assert.equal(canDeleteHistory({ auto: false, kind: 'salary' }, false), false)
  assert.equal(canDeleteHistory({ auto: true, kind: 'salary' }, true), true)
})
