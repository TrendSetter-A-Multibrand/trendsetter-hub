import test from 'node:test'
import assert from 'node:assert/strict'
import strings from '../strings.js'
import { ACTION_GROUPS, UNGROUPED, GROUP_KEYS, actionsOfGroup, auditQuery, formatAt, formatDetails } from './audit.js'

test('каждое известное действие входит ровно в одну группу или в список служебных', () => {
  const seen = new Map()
  for (const [group, actions] of Object.entries(ACTION_GROUPS)) {
    for (const a of actions) seen.set(a, [...(seen.get(a) ?? []), group])
  }
  for (const a of UNGROUPED) seen.set(a, [...(seen.get(a) ?? []), 'ungrouped'])
  for (const [action, where] of seen) assert.equal(where.length, 1, `${action}: ${where}`)
  for (const action of Object.keys(strings.audit.labels)) assert.ok(seen.has(action), `нет в группах: ${action}`)
  for (const action of seen.keys()) assert.ok(strings.audit.labels[action], `нет подписи: ${action}`)
})

test('у каждой группы есть подпись', () => {
  for (const key of GROUP_KEYS) assert.ok(strings.audit.groups[key])
})

test('actionsOfGroup: список действий группы через запятую, без группы — undefined; группы укладываются в лимит сервера', () => {
  assert.equal(actionsOfGroup('export'), 'hr.export')
  assert.ok(actionsOfGroup('money').split(',').includes('hr.sensitive_view'))
  assert.equal(actionsOfGroup(null), undefined)
  assert.equal(actionsOfGroup('nope'), undefined)
  for (const key of GROUP_KEYS) {
    const list = actionsOfGroup(key).split(',')
    assert.ok(list.length <= 40)
    assert.ok(list.every((a) => /^[a-z_]+\.[a-z_]+$/.test(a)))
  }
})

test('formatDetails: компактный текст, person_id и неизвестные ключи скрыты', () => {
  assert.equal(formatDetails({ person_id: 5, document_id: 7, category: 'tax' }), 'документ №7 · категория: tax')
  assert.equal(formatDetails({ fields: ['salary', 'currency'], sensitive: true }), 'поля: salary, currency · ПДн: да')
  assert.equal(formatDetails({ person_id: 5, secret: 'x' }), '')
  assert.equal(formatDetails(null), '')
})

test('formatAt: ДД.ММ.ГГГГ ЧЧ:ММ без запятой', () => {
  assert.match(formatAt('2026-10-24T11:05:00Z'), /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/)
})

test('auditQuery: пустые фильтры не передаются, action списком', () => {
  assert.equal(auditQuery({ personId: null, from: null, to: null, limit: 50, offset: 0 }), 'limit=50&offset=0')
  assert.equal(auditQuery({ action: 'hr.export,hr.leave_request', limit: 50, offset: 0 }), 'action=hr.export%2Chr.leave_request&limit=50&offset=0')
  assert.equal(
    auditQuery({ personId: 3, from: '2026-10-01', to: '2026-10-24', limit: 50, offset: 100 }),
    'personId=3&from=2026-10-01&to=2026-10-24&limit=50&offset=100',
  )
})
