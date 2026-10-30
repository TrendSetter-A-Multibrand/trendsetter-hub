import test from 'node:test'
import assert from 'node:assert/strict'

// client.js -> session.js работает с sessionStorage — в Node его нет
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

const { ApiError } = await import('../client.js')
const { computeModuleAccess } = await import('../../access.js')
const { data } = await import('./data.js')
const { createFeedbackHandlers } = await import('./feedback.js')

const ADMIN = 'mock:1'
const EMPLOYEE = 'mock:3'
const VIEWER = 'mock:5'
const READER = 'mock:13' // HR — демо-читатель (responsible на feedback)
const SUPERUSER = 'mock:2'
const errors = new Proxy({}, { get: (_, key) => String(key) })

const userFromToken = (token) => {
  if (!token) throw new ApiError(401, 'unauthorized')
  return data.users.find((u) => u.id === Number(token.split(':')[1]))
}
const accessTo = (user) => computeModuleAccess(user, [], [], true)
const isReader = (user) => user.access_level === 'admin' || data.userModulePermissions[user.id]?.feedback === 'responsible'

function setup(over = {}) {
  const notified = []
  const clock = { now: new Date('2026-06-15T12:00:00Z') }
  const api = createFeedbackHandlers({
    userFromToken, accessTo, isReader, errors, now: () => clock.now,
    readerIds: () => data.users.filter(isReader).map((u) => u.id),
    notify: (ids, n) => notified.push({ ids, ...n }),
    ...over,
  })
  const call = (key, token, extra = {}) => api.handlers[key]({ token, ...extra })
  return { ...api, call, notified, clock }
}
const fails = (fn, status) => assert.throws(fn, (e) => e instanceof ApiError && e.status === status)
const post = (ctx, token, body) => ctx.call('POST /modules/feedback/messages', token, { body })

test('права: 401 без токена, viewer не отправляет, не читатель — 403 на списки и правку', () => {
  const ctx = setup()
  fails(() => post(ctx, undefined, { kind: 'idea', body: 'x', anonymous: true }), 401)
  fails(() => post(ctx, VIEWER, { kind: 'idea', body: 'x', anonymous: true }), 403)
  fails(() => ctx.call('GET /modules/feedback/mine', VIEWER), 403)
  fails(() => ctx.call('GET /modules/feedback/people', VIEWER), 403)
  for (const token of [EMPLOYEE, SUPERUSER]) {
    fails(() => ctx.call('GET /modules/feedback/messages', token, { query: { status: 'new' } }), 403)
    fails(() => ctx.call('PATCH /modules/feedback/messages/:id', token, { params: { id: '1' }, body: { status: 'closed' } }), 403)
  }
  assert.ok(ctx.call('GET /modules/feedback/messages', READER, { query: { status: 'new' } }).items.length > 0)
  assert.ok(ctx.call('GET /modules/feedback/messages', ADMIN, { query: { status: 'new' } }).items.length > 0)
})

test('анонимная запись не содержит id и имени автора; ответ {ok: true}; в /mine не попадает', () => {
  const ctx = setup()
  const author = userFromToken(EMPLOYEE)
  assert.deepEqual(post(ctx, EMPLOYEE, { kind: 'complaint', body: 'уникальный-текст-анонима', anonymous: true }), { ok: true })
  const row = ctx.storage().find((r) => r.body === 'уникальный-текст-анонима')
  assert.equal(row.authorId, null)
  assert.equal(row.updatedBy, null)
  const stored = JSON.stringify(row)
  assert.ok(!stored.includes(author.full_name) && !stored.includes(author.email))
  assert.ok(!Object.values(row).includes(author.id))
  assert.ok(!ctx.call('GET /modules/feedback/mine', EMPLOYEE).items.some((i) => i.body === 'уникальный-текст-анонима'))
  const item = ctx.call('GET /modules/feedback/messages', READER, { query: { status: 'new' } }).items.find((i) => i.body === 'уникальный-текст-анонима')
  assert.equal(item.anonymous, true)
  assert.equal(item.authorName, null)
})

test('уведомление получают все читатели, включая автора-читателя; без текста', () => {
  const ctx = setup()
  post(ctx, READER, { kind: 'idea', body: 'x', anonymous: true })
  assert.equal(ctx.notified.length, 1)
  assert.deepEqual(ctx.notified[0].ids.sort(), data.users.filter(isReader).map((u) => u.id).sort())
  assert.ok(ctx.notified[0].ids.includes(13))
  assert.equal(ctx.notified[0].body, '')
})

test('валидация: contactOk при анонимно, адресат не у благодарности, сам автор, лишний ключ, пустой и длинный текст', () => {
  const ctx = setup()
  fails(() => post(ctx, EMPLOYEE, { kind: 'idea', body: 'x', anonymous: true, contactOk: true }), 422)
  fails(() => post(ctx, EMPLOYEE, { kind: 'idea', body: 'x', anonymous: false, recipientId: 10 }), 422)
  fails(() => post(ctx, EMPLOYEE, { kind: 'thanks', body: 'x', anonymous: false, recipientId: 3 }), 422)
  fails(() => post(ctx, EMPLOYEE, { kind: 'thanks', body: 'x', anonymous: false, recipientId: 7 }), 422) // отключён
  fails(() => post(ctx, EMPLOYEE, { kind: 'thanks', body: 'x', anonymous: false, recipientId: 9999 }), 422)
  fails(() => post(ctx, EMPLOYEE, { kind: 'idea', body: 'x', anonymous: true, extra: 1 }), 422)
  fails(() => post(ctx, EMPLOYEE, { kind: 'idea', body: '   ', anonymous: true }), 422)
  fails(() => post(ctx, EMPLOYEE, { kind: 'idea', body: 'я'.repeat(3001), anonymous: true }), 422)
  fails(() => post(ctx, EMPLOYEE, { kind: 'bad', body: 'x', anonymous: true }), 422)
})

test('именная отправка: /mine показывает без note; людей для адресата без себя', () => {
  const ctx = setup()
  const out = post(ctx, EMPLOYEE, { kind: 'thanks', body: ' спасибо ', anonymous: false, contactOk: true, recipientId: 10 })
  assert.equal(out.body, 'спасибо')
  assert.equal(out.recipientName, 'Кравцов Денис')
  assert.equal('note' in out, false)
  assert.ok(ctx.call('GET /modules/feedback/mine', EMPLOYEE).items.some((i) => i.id === out.id))
  const people = ctx.call('GET /modules/feedback/people', EMPLOYEE)
  assert.ok(!people.some((p) => p.id === 3) && !people.some((p) => p.id === 7))
})

test('лимит 10 в сутки: 11-я — 429, через сутки снова можно, у другого свой', () => {
  const ctx = setup()
  for (let i = 0; i < 10; i += 1) post(ctx, EMPLOYEE, { kind: 'idea', body: 'x', anonymous: i % 2 === 0 })
  fails(() => post(ctx, EMPLOYEE, { kind: 'idea', body: 'x', anonymous: true }), 429)
  post(ctx, ADMIN, { kind: 'idea', body: 'x', anonymous: true })
  ctx.clock.now = new Date(ctx.clock.now.getTime() + 86400 * 1000 + 1000)
  post(ctx, EMPLOYEE, { kind: 'idea', body: 'x', anonymous: true })
})

test('разбор: статус и комментарий, пустой комментарий — null, пустой PATCH и неизвестный id', () => {
  const ctx = setup()
  const patch = (token, id, body) => ctx.call('PATCH /modules/feedback/messages/:id', token, { params: { id: String(id) }, body })
  const item = patch(READER, 1, { status: 'in_progress', note: '  заметка ' })
  assert.equal(item.status, 'in_progress')
  assert.equal(item.note, 'заметка')
  assert.equal(item.updatedByName, 'Назаров Тимур')
  assert.equal(patch(READER, 1, { note: '   ' }).note, null)
  fails(() => patch(READER, 1, {}), 422)
  fails(() => patch(READER, 1, { status: 'bad' }), 422)
  fails(() => patch(READER, 9999, { status: 'closed' }), 404)
})

test('список: фильтры, счётчики и бейдж только читателю', () => {
  const ctx = setup()
  const all = ctx.call('GET /modules/feedback/messages', READER, { query: { status: 'new' } })
  assert.equal(all.total, all.counts.new)
  const ideas = ctx.call('GET /modules/feedback/messages', READER, { query: { status: 'in_progress', kind: 'idea' } })
  assert.equal(ideas.total, 1)
  fails(() => ctx.call('GET /modules/feedback/messages', READER, { query: { status: 'bad' } }), 422)
  assert.equal(ctx.moduleBadges(userFromToken(READER)).feedback, all.counts.new)
  assert.deepEqual(ctx.moduleBadges(userFromToken(EMPLOYEE)), {})
})
