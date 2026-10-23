import test from 'node:test'
import assert from 'node:assert/strict'
import { activeTemplates, hasActiveChecklist, pickTemplateId, startAutoChecklist } from './autoChecklist.js'

const templates = [
  { id: 1, kind: 'onboarding', active: false, items: [] },
  { id: 2, kind: 'offboarding', active: true, items: [] },
  { id: 3, kind: 'onboarding', active: true, items: [] },
  { id: 4, kind: 'onboarding', active: true, items: [] },
]

test('автозапуск: активные шаблоны вида и выбор шаблона по умолчанию', () => {
  const list = activeTemplates(templates, 'onboarding')
  assert.deepEqual(list.map((t) => t.id), [3, 4])
  assert.equal(pickTemplateId(list, null), 3, 'по умолчанию первый')
  assert.equal(pickTemplateId(list, 4), 4)
  assert.equal(pickTemplateId(list, 1), 3, 'неактивный выбор заменяется первым активным')
  assert.equal(pickTemplateId([], 3), null)
  assert.deepEqual(activeTemplates(templates, 'offboarding').map((t) => t.id), [2])
})

test('автозапуск: активный чек-лист того же вида', () => {
  const list = [{ kind: 'onboarding', status: 'active' }, { kind: 'offboarding', status: 'done' }]
  assert.equal(hasActiveChecklist(list, 'onboarding'), true)
  assert.equal(hasActiveChecklist(list, 'offboarding'), false)
})

test('автозапуск: запуск, пропуск при существующем, сбой', async () => {
  const calls = []
  const api = {
    get: async () => [{ kind: 'offboarding', status: 'active' }],
    post: async (path, body) => {
      calls.push([path, body])
      return { id: 7 }
    },
  }
  assert.deepEqual(await startAutoChecklist(api, { personId: 5, templateId: 3, kind: 'onboarding' }), { status: 'started', checklist: { id: 7 } })
  assert.deepEqual(calls, [['/modules/hr/people/5/checklists', { templateId: 3 }]])
  assert.deepEqual(await startAutoChecklist(api, { personId: 5, templateId: 2, kind: 'offboarding', skipIfActive: true }), { status: 'exists' })
  assert.equal(calls.length, 1, 'повторно не запускали')
  const broken = { get: async () => { throw new Error('x') }, post: async () => { throw new Error('boom') } }
  assert.deepEqual(await startAutoChecklist(broken, { personId: 5, templateId: 3, kind: 'offboarding', skipIfActive: true }), { status: 'failed' })
})
