import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPayload, canSendFeedback, isFeedbackReader } from './feedback.js'

const user = (over) => ({ access_level: 'employee', can_manage_users: false, module_access: { feedback: 'view' }, module_responsible: { feedback: false }, ...over })

test('isFeedbackReader: admin и responsible — да; superuser без права и employee с run — нет', () => {
  assert.equal(isFeedbackReader(user({ access_level: 'admin', can_manage_users: true, module_access: { feedback: 'run' } })), true)
  assert.equal(isFeedbackReader(user({ access_level: 'superuser', module_access: { feedback: 'run' } })), false)
  assert.equal(isFeedbackReader(user({ module_access: { feedback: 'run' } })), false)
  assert.equal(isFeedbackReader(user({ module_responsible: { feedback: true } })), true)
  assert.equal(isFeedbackReader(undefined), false)
})

test('canSendFeedback: view/run — да, viewer (structure) — нет', () => {
  assert.equal(canSendFeedback(user({})), true)
  assert.equal(canSendFeedback(user({ module_access: { feedback: 'run' } })), true)
  assert.equal(canSendFeedback(user({ access_level: 'viewer', module_access: { feedback: 'structure' } })), false)
  assert.equal(canSendFeedback(null), false)
})

test('buildPayload: анонимно сбрасывает contactOk, не благодарность — recipientId, текст обрезается', () => {
  assert.deepEqual(buildPayload({ kind: 'idea', body: '  текст  ', anonymous: true, contactOk: true, recipientId: 5 }), {
    kind: 'idea', body: 'текст', anonymous: true, contactOk: false, recipientId: null,
  })
  assert.deepEqual(buildPayload({ kind: 'thanks', body: 'спасибо', anonymous: false, contactOk: true, recipientId: 5 }), {
    kind: 'thanks', body: 'спасибо', anonymous: false, contactOk: true, recipientId: 5,
  })
  assert.equal(buildPayload({ kind: 'thanks', body: 'x', anonymous: true, recipientId: 7 }).recipientId, 7)
  assert.equal(buildPayload({ kind: 'thanks', body: 'x', anonymous: false }).recipientId, null)
})
