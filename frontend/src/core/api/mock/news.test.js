import test from 'node:test'
import assert from 'node:assert/strict'

// client.js -> session.js работает с sessionStorage — в Node его нет
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

const { ApiError } = await import('../client.js')
const { computeModuleAccess } = await import('../../access.js')
const { data } = await import('./data.js')
const { createNewsHandlers } = await import('./news.js')

const ADMIN = 'mock:1'
const EMPLOYEE = 'mock:3'
const VIEWER = 'mock:5'
const EDITOR = 'mock:9' // «Сотрудник HR» — демо-редактор
// Тексты ошибок в приложении приходят из реестра модулей; в тесте достаточно заглушки
const errors = new Proxy({}, { get: (_, key) => String(key) })
const NOW = new Date('2026-11-01T12:00:00Z')
const HOUR = 3600 * 1000

const userFromToken = (token) => {
  if (!token) throw new ApiError(401, 'unauthorized')
  return data.users.find((u) => u.id === Number(token.split(':')[1]))
}
const accessTo = (user) => computeModuleAccess(user, [], [], true)
const isEditor = (user) => user.access_level === 'admin' || data.userModulePermissions[user.id]?.news === 'responsible'

// Каждый тест — свой набор данных и свои часы
function setup() {
  const clock = { now: new Date(NOW) }
  const { handlers } = createNewsHandlers({ userFromToken, accessTo, isEditor, errors, now: () => clock.now })
  const call = (route, { token, params, query, body } = {}) => handlers[route]({ params, query: query ?? {}, body, token })
  const after = (hours) => {
    clock.now = new Date(NOW.getTime() + hours * HOUR)
  }
  return { call, after }
}

const status = (fn, expected) => {
  assert.throws(fn, (e) => e instanceof ApiError && e.status === expected)
}
const iso = (hours) => new Date(NOW.getTime() + hours * HOUR).toISOString()

test('без токена — 401', () => {
  const { call } = setup()
  for (const route of ['GET /modules/news/feed', 'GET /modules/news/banner', 'GET /modules/news/items', 'POST /modules/news/banner/off']) {
    status(() => call(route, {}), 401)
  }
})

test('viewer — 403 на feed, banner, rsvp, responses', () => {
  const { call } = setup()
  status(() => call('GET /modules/news/feed', { token: VIEWER }), 403)
  status(() => call('GET /modules/news/banner', { token: VIEWER }), 403)
  status(() => call('POST /modules/news/items/:id/rsvp', { token: VIEWER, params: { id: 1 }, body: { answer: 'yes' } }), 403)
  status(() => call('GET /modules/news/items/:id/responses', { token: VIEWER, params: { id: 1 } }), 403)
})

test('не-редактор: 403 на items и редакторских', () => {
  const { call } = setup()
  status(() => call('GET /modules/news/items', { token: EMPLOYEE, query: { tab: 'current' } }), 403)
  status(() => call('POST /modules/news/items', { token: EMPLOYEE, body: { kind: 'news', title: 'Т' } }), 403)
  status(() => call('PATCH /modules/news/items/:id', { token: EMPLOYEE, params: { id: 1 }, body: { pinned: true } }), 403)
  status(() => call('POST /modules/news/items/:id/delete', { token: EMPLOYEE, params: { id: 1 } }), 403)
  status(() => call('POST /modules/news/banner', { token: EMPLOYEE, body: { text: 'Т' } }), 403)
  status(() => call('POST /modules/news/banner/off', { token: EMPLOYEE }), 403)
})

test('демо-данные: feed содержит закреплённое событие с RSVP, черновика и архива нет', () => {
  const { call } = setup()
  const feed = call('GET /modules/news/feed', { token: EMPLOYEE })
  assert.equal(feed.events[0].pinned, true)
  assert.equal(feed.events[0].rsvp.open, true)
  assert.equal(feed.events.length, 2)
  assert.equal(feed.news.length, 3)
  assert.equal(feed.news[0].pinned, true)
  assert.ok([...feed.events, ...feed.news].every((i) => i.status === 'published' && !i.archived))
  assert.ok(call('GET /modules/news/banner', { token: EMPLOYEE }).banner)
})

test('RSVP черновика — 404 не-редактору; responses черновика — 404 не-редактору, 200 редактору', () => {
  const { call } = setup()
  const draft = call('GET /modules/news/items', { token: ADMIN, query: { tab: 'drafts' } }).items[0]
  status(() => call('POST /modules/news/items/:id/rsvp', { token: EMPLOYEE, params: { id: draft.id }, body: { answer: 'yes' } }), 404)
  status(() => call('GET /modules/news/items/:id/responses', { token: EMPLOYEE, params: { id: draft.id } }), 404)
  assert.ok(call('GET /modules/news/items/:id/responses', { token: ADMIN, params: { id: draft.id } }))
})

test('responses для сотрудника: 403 при rsvpNamesPublic = false, 200 при true', () => {
  const { call } = setup()
  const { events } = call('GET /modules/news/feed', { token: EMPLOYEE })
  const open = events.find((e) => e.rsvpNamesPublic === false)
  const publicOne = events.find((e) => e.rsvpNamesPublic === true)
  assert.equal(open.rsvp.canSeeNames, false)
  status(() => call('GET /modules/news/items/:id/responses', { token: EMPLOYEE, params: { id: open.id } }), 403)
  const names = call('GET /modules/news/items/:id/responses', { token: EMPLOYEE, params: { id: publicOne.id } })
  assert.deepEqual(Object.keys(names), ['yes', 'maybe', 'no'])
  assert.ok(names.yes.length > 0)
  assert.ok(call('GET /modules/news/items/:id/responses', { token: EDITOR, params: { id: open.id } }))
})

test('прошедшее событие уходит из feed в past при сдвинутом now', () => {
  const { call, after } = setup()
  const picnic = call('GET /modules/news/feed', { token: EMPLOYEE }).events[0]
  assert.ok(!call('GET /modules/news/items', { token: ADMIN, query: { tab: 'past' } }).items.some((i) => i.id === picnic.id))
  after(8 * 24)
  assert.ok(!call('GET /modules/news/feed', { token: EMPLOYEE }).events.some((i) => i.id === picnic.id))
  assert.ok(call('GET /modules/news/items', { token: ADMIN, query: { tab: 'past' } }).items.some((i) => i.id === picnic.id))
})

test('RSVP: смена ответа, после срока — 409, news — 409', () => {
  const { call, after } = setup()
  const event = call('GET /modules/news/feed', { token: EMPLOYEE }).events[0]
  const url = 'POST /modules/news/items/:id/rsvp'
  let out = call(url, { token: EMPLOYEE, params: { id: event.id }, body: { answer: 'no' } })
  assert.equal(out.rsvp.myAnswer, 'no')
  const before = out.rsvp.counts
  out = call(url, { token: EMPLOYEE, params: { id: event.id }, body: { answer: 'yes' } })
  assert.equal(out.rsvp.counts.yes, before.yes + 1)
  assert.equal(out.rsvp.counts.no, before.no - 1)
  const news = call('GET /modules/news/feed', { token: EMPLOYEE }).news[0]
  status(() => call(url, { token: EMPLOYEE, params: { id: news.id }, body: { answer: 'yes' } }), 409)
  status(() => call(url, { token: EMPLOYEE, params: { id: event.id }, body: { answer: 'perhaps' } }), 422)
  after(6 * 24) // после срока ответа (5 дней), до начала (7 дней)
  status(() => call(url, { token: EMPLOYEE, params: { id: event.id }, body: { answer: 'no' } }), 409)
})

test('счётчики и имена — только активные пользователи', () => {
  const { call } = setup()
  const picnic = call('GET /modules/news/feed', { token: EMPLOYEE }).events[0]
  const before = picnic.rsvp.counts.yes
  const user = data.users.find((u) => u.id === 4)
  user.is_active = false
  try {
    const after = call('GET /modules/news/feed', { token: EMPLOYEE }).events[0]
    assert.equal(after.rsvp.counts.yes, before - 1)
    const names = call('GET /modules/news/items/:id/responses', { token: EMPLOYEE, params: { id: picnic.id } })
    assert.ok(!names.yes.some((p) => p.userId === 4))
  } finally {
    user.is_active = true
  }
})

test('плашка: тот же текст — тот же id, новый текст — новый id, off и истёкшая — null', () => {
  const { call, after } = setup()
  const post = (body) => call('POST /modules/news/banner', { token: ADMIN, body }).banner
  const current = call('GET /modules/news/banner', { token: EMPLOYEE }).banner
  const same = post({ text: current.text, endsAt: iso(2) })
  assert.equal(same.id, current.id)
  assert.equal(same.endsAt, iso(2))
  const other = post({ text: 'Другой текст' })
  assert.notEqual(other.id, current.id)
  assert.equal(call('GET /modules/news/banner', { token: EMPLOYEE }).banner.id, other.id)
  status(() => post({ text: 'Т', endsAt: iso(-1) }), 422)
  status(() => post({ text: '   ' }), 422)
  const timed = post({ text: 'С сроком', endsAt: iso(1) })
  after(2)
  assert.equal(call('GET /modules/news/banner', { token: EMPLOYEE }).banner, null)
  assert.equal(timed.text, 'С сроком')
  after(0)
  assert.equal(call('POST /modules/news/banner/off', { token: ADMIN }).banner, null)
  const again = post({ text: 'Другой текст' })
  assert.notEqual(again.id, other.id)
})

test('редактор: создание, валидация, публикация, удаление', () => {
  const { call } = setup()
  const create = (body) => call('POST /modules/news/items', { token: EDITOR, body })
  status(() => create({ kind: 'event', title: 'Т' }), 422)
  status(() => create({ kind: 'event', title: 'Т', startsAt: iso(10), endsAt: iso(5) }), 422)
  status(() => create({ kind: 'event', title: 'Т', startsAt: '2026-11-05T10:00:00' }), 422)
  status(() => create({ kind: 'news', title: 'Т', place: 'Офис' }), 422)
  status(() => create({ kind: 'news', title: '' }), 422)
  const item = create({ kind: 'news', title: '  Тест  ' })
  assert.equal(item.title, 'Тест')
  assert.equal(item.status, 'draft')
  assert.equal(item.publishedAt, null)
  status(() => call('PATCH /modules/news/items/:id', { token: EDITOR, params: { id: item.id }, body: { kind: 'event' } }), 422)
  const published = call('PATCH /modules/news/items/:id', { token: EDITOR, params: { id: item.id }, body: { status: 'published' } })
  assert.equal(published.publishedAt, NOW.toISOString())
  assert.ok(call('GET /modules/news/feed', { token: EMPLOYEE }).news.some((n) => n.id === item.id))
  assert.deepEqual(call('POST /modules/news/items/:id/delete', { token: EDITOR, params: { id: item.id } }), { ok: true })
  status(() => call('POST /modules/news/items/:id/delete', { token: EDITOR, params: { id: item.id } }), 404)
  status(() => call('GET /modules/news/items', { token: EDITOR, query: { tab: 'x' } }), 422)
})
