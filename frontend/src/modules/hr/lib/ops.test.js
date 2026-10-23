import test from 'node:test'
import assert from 'node:assert/strict'
import { canDeleteHistory, checklistProgress, copyTemplateItems, defaultBaseTemplate, isEquipmentOverdue, isItemOverdue, itemsEdited } from './ops.js'

test('новый шаблон: основа — первый активный шаблон вида, пункты копируются', () => {
  const templates = [
    { id: 1, kind: 'onboarding', active: false, items: [{ title: 'Старый', daysOffset: 1 }] },
    { id: 2, kind: 'offboarding', active: true, items: [{ title: 'Сдать ноутбук', daysOffset: 0 }] },
    { id: 3, kind: 'onboarding', active: true, items: [{ title: 'Выдать доступы', daysOffset: 0 }, { title: 'Знакомство' }] },
  ]
  const base = defaultBaseTemplate(templates, 'onboarding')
  assert.equal(base.id, 3)
  assert.equal(defaultBaseTemplate([templates[0]], 'onboarding'), null)
  const copy = copyTemplateItems(base)
  assert.deepEqual(copy, [{ title: 'Выдать доступы', daysOffset: 0 }, { title: 'Знакомство', daysOffset: null }])
  copy[0].title = 'X'
  assert.equal(base.items[0].title, 'Выдать доступы', 'копия не меняет оригинал')
  assert.deepEqual(copyTemplateItems(null), [{ title: '', daysOffset: null }])
})

test('новый шаблон: правки пунктов относительно заполнения', () => {
  const seed = [{ title: 'А', daysOffset: 2 }]
  assert.equal(itemsEdited([{ key: 5, title: 'А', daysOffset: 2 }], seed), false)
  assert.equal(itemsEdited([{ key: 5, title: 'Б', daysOffset: 2 }], seed), true)
  assert.equal(itemsEdited([{ key: 5, title: 'А', daysOffset: null }], seed), true)
  assert.equal(itemsEdited([], seed), true)
})

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
