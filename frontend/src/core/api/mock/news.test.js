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
  const notes = [] // уведомления, переданные в notify
  const notify = (userIds, note) => notes.push({ userIds, ...note })
  const userById = (id) => data.users.find((u) => u.id === Number(id)) ?? null
  const { handlers, moduleBadges } = createNewsHandlers({ userFromToken, accessTo, isEditor, notify, userById, errors, now: () => clock.now })
  const call = (route, { token, params, query, body } = {}) => handlers[route]({ params, query: query ?? {}, body, token })
  const after = (hours) => {
    clock.now = new Date(NOW.getTime() + hours * HOUR)
  }
  return { call, after, notes, moduleBadges }
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
  assert.equal(feed.news.length, 4) // три новости и опубликованное предложение
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

test('цвет записи: сохранение, сброс в null, валидация, виден читателю', () => {
  const { call } = setup()
  const create = (body) => call('POST /modules/news/items', { token: EDITOR, body })
  const patch = (id, body) => call('PATCH /modules/news/items/:id', { token: EDITOR, params: { id }, body })
  assert.equal(create({ kind: 'news', title: 'Без цвета' }).color, null)
  for (const bad of ['#A22325', 'purple', '', 5]) status(() => create({ kind: 'news', title: 'Т', color: bad }), 422)
  const item = create({ kind: 'news', title: 'Цветная', color: 'blue', status: 'published' })
  assert.equal(item.color, 'blue')
  status(() => patch(item.id, { color: '#fff' }), 422)
  assert.equal(patch(item.id, { color: 'gray' }).color, 'gray')
  assert.equal(call('GET /modules/news/feed', { token: EMPLOYEE }).news.find((n) => n.id === item.id).color, 'gray')
  assert.equal(patch(item.id, { color: null }).color, null)
})

// ---------- предложка и модерация (docs/TZ-news-moderation.md) ----------

const AUTHOR = 'mock:4' // «Сотрудник WB» — автор без демо-предложений
const ANI = 'mock:3' // автор демо-предложений
const DENIS = 'mock:10' // автор отклонённого предложения
const P = 'POST /modules/news/proposals'
const mine = (call, token) => call('GET /modules/news/proposals/mine', { token }).items
const review = (call, token = EDITOR) => call('GET /modules/news/items', { token, query: { tab: 'review' } })
const decideCall = (call, token, item, action, comment = 'Комментарий', expectedUpdatedAt = item.updatedAt) =>
  call(`POST /modules/news/items/:id/${action}`, { token, params: { id: item.id }, body: { expectedUpdatedAt, ...(action === 'approve' ? {} : { comment }) } })
const propose = (call, token, over = {}) => call(P, { token, body: { kind: 'news', title: 'Предложение', ...over } })

test('предложка: права и коды (401 / 403 viewer / 403 не-редактор на проверке)', () => {
  const { call } = setup()
  for (const route of [P, 'GET /modules/news/proposals/mine', 'PATCH /modules/news/proposals/:id']) status(() => call(route, { params: { id: 1 }, body: {} }), 401)
  for (const route of [P, 'GET /modules/news/proposals/mine', 'PATCH /modules/news/proposals/:id']) {
    status(() => call(route, { token: VIEWER, params: { id: 1 }, body: { kind: 'news', title: 'Т' } }), 403)
  }
  status(() => call('GET /modules/news/items', { token: AUTHOR, query: { tab: 'review' } }), 403)
  for (const action of ['approve', 'return', 'reject']) {
    status(() => decideCall(call, AUTHOR, { id: 1, updatedAt: NOW.toISOString() }, action), 403)
  }
  assert.ok(propose(call, EDITOR)) // редактор тоже может подать
})

test('демо-данные: все статусы, review.author через userById, служебных полей нет', () => {
  const { call } = setup()
  const ani = mine(call, ANI)
  assert.deepEqual(ani.map((i) => i.status).sort(), ['needs_changes', 'pending', 'published'])
  const returned = ani.find((i) => i.status === 'needs_changes')
  assert.equal(returned.review.author.name, 'Ани С.')
  assert.ok(returned.review.reviewComment)
  assert.ok(!('createdBy' in returned) && !('submittedAt' in returned))
  assert.equal(mine(call, DENIS)[0].status, 'rejected')
  assert.equal(mine(call, DENIS)[0].review.author.name, 'Кравцов Денис')
  const list = review(call)
  assert.deepEqual(list.items.map((i) => i.status), ['pending', 'needs_changes'])
  assert.equal(list.total, 2)
  // rejected — во вкладке past; в ленте предложений нет, у обычных записей review = null
  assert.ok(call('GET /modules/news/items', { token: EDITOR, query: { tab: 'past' } }).items.some((i) => i.status === 'rejected'))
  assert.ok(call('GET /modules/news/items', { token: EDITOR, query: { tab: 'current' } }).items.every((i) => i.review === null || i.review.author))
  const feed = call('GET /modules/news/feed', { token: AUTHOR })
  assert.ok([...feed.news, ...feed.events].every((i) => !('review' in i)))
  assert.ok(!feed.news.some((i) => i.status !== 'published'))
})

test('создание предложения: pending, без pinned, лишние ключи и валидация — 422', () => {
  const { call } = setup()
  const p = propose(call, AUTHOR, { color: 'green' })
  assert.equal(p.status, 'pending')
  assert.equal(p.pinned, false)
  assert.equal(p.color, 'green')
  assert.equal(p.publishedAt, null)
  assert.equal(p.review.submittedAt, NOW.toISOString())
  assert.equal(p.review.author.id, 4)
  status(() => propose(call, AUTHOR, { pinned: true }), 422)
  status(() => propose(call, AUTHOR, { status: 'published' }), 422)
  status(() => propose(call, AUTHOR, { kind: 'event' }), 422)
  status(() => propose(call, AUTHOR, { kind: 'news', place: 'Офис' }), 422)
  assert.ok(!call('GET /modules/news/feed', { token: AUTHOR }).news.some((n) => n.id === p.id))
})

test('автор: чужое и запись редактора — 404, published — 409, повторная подача', () => {
  const { call, after } = setup()
  const own = propose(call, AUTHOR)
  const patch = (token, id, body) => call('PATCH /modules/news/proposals/:id', { token, params: { id }, body })
  const editorsItem = call('POST /modules/news/items', { token: EDITOR, body: { kind: 'news', title: 'Т' } })
  status(() => patch(ANI, own.id, { title: 'Х' }), 404)
  status(() => patch(AUTHOR, editorsItem.id, { title: 'Х' }), 404)
  status(() => patch(AUTHOR, 99999, { title: 'Х' }), 404)
  for (const bad of [{ pinned: true }, { status: 'draft' }, { archived: true }, { kind: 'event' }]) status(() => patch(AUTHOR, own.id, bad), 422)
  after(1)
  const edited = patch(AUTHOR, own.id, { title: 'Новое' })
  assert.equal(edited.status, 'pending')
  assert.equal(edited.review.submittedAt, own.review.submittedAt) // pending -> pending: очередь прежняя
  const returned = decideCall(call, EDITOR, edited, 'return', 'Доработайте')
  after(2)
  const again = patch(AUTHOR, own.id, {})
  assert.equal(again.status, 'pending')
  assert.notEqual(again.review.submittedAt, own.review.submittedAt)
  assert.equal(again.review.reviewComment, returned.review.reviewComment)
  const rejected = decideCall(call, EDITOR, again, 'reject', 'Нет')
  assert.equal(rejected.status, 'rejected')
  assert.equal(patch(AUTHOR, own.id, { body: 'Доработано' }).status, 'pending') // rejected -> pending
  const done = decideCall(call, EDITOR, mine(call, AUTHOR).find((i) => i.id === own.id), 'approve')
  assert.equal(done.status, 'published')
  status(() => patch(AUTHOR, own.id, { title: 'Х' }), 409)
})

test('проверка: только из pending, устаревший expectedUpdatedAt — 409, комментарий 1..1000, публикация попадает в ленту', () => {
  const { call } = setup()
  const p = propose(call, AUTHOR)
  status(() => decideCall(call, EDITOR, p, 'approve', '', new Date(NOW.getTime() - HOUR).toISOString()), 409)
  status(() => decideCall(call, EDITOR, p, 'return', '   '), 422)
  status(() => decideCall(call, EDITOR, p, 'reject', 'я'.repeat(1001)), 422)
  status(() => call('POST /modules/news/items/:id/approve', { token: EDITOR, params: { id: p.id }, body: {} }), 422)
  status(() => decideCall(call, EDITOR, { id: 99999, updatedAt: p.updatedAt }, 'approve'), 404)
  const approved = decideCall(call, EDITOR, p, 'approve')
  assert.equal(approved.status, 'published')
  assert.equal(approved.publishedAt, NOW.toISOString())
  assert.ok(call('GET /modules/news/feed', { token: AUTHOR }).news.some((n) => n.id === p.id))
  for (const action of ['approve', 'return', 'reject']) status(() => decideCall(call, EDITOR, p, action), 409)
  // не pending: needs_changes из демо-данных
  const returned = mine(call, ANI).find((i) => i.status === 'needs_changes')
  status(() => decideCall(call, EDITOR, returned, 'approve'), 409)
})

test('PATCH редактора: нельзя обойти модерацию; правка содержимого pending, затем approve с updatedAt из ответа PATCH', () => {
  const { call, after } = setup()
  const patch = (id, body) => call('PATCH /modules/news/items/:id', { token: EDITOR, params: { id }, body })
  const p = propose(call, AUTHOR)
  status(() => patch(p.id, { status: 'published' }), 409)
  status(() => patch(p.id, { archived: true }), 409)
  after(1)
  const patched = patch(p.id, { title: 'Правка', pinned: true })
  assert.equal(patched.status, 'pending')
  assert.equal(patched.pinned, true)
  status(() => decideCall(call, EDITOR, p, 'approve'), 409) // updatedAt до PATCH устарел
  assert.equal(decideCall(call, EDITOR, patched, 'approve').status, 'published')
  const returned = mine(call, ANI).find((i) => i.status === 'needs_changes')
  const rejected = mine(call, DENIS)[0]
  status(() => patch(returned.id, { title: 'Х' }), 409)
  status(() => patch(rejected.id, { title: 'Х' }), 409)
})

test('уведомления: по одному автору на решение; себе — нет; неактивному — нет (обрабатывает notify)', () => {
  const { call, notes } = setup()
  const p = propose(call, AUTHOR, { title: 'Субботник' })
  decideCall(call, EDITOR, p, 'return', 'Добавьте место')
  assert.equal(notes.length, 1)
  assert.deepEqual(notes[0].userIds, [4])
  assert.equal(notes[0].kind, 'news_review')
  assert.equal(notes[0].title, 'Новость нужно доработать')
  assert.equal(notes[0].body, '«Субботник»: Добавьте место')
  assert.equal(notes[0].link, '/profile?section=proposals')
  const again = call('PATCH /modules/news/proposals/:id', { token: AUTHOR, params: { id: p.id }, body: {} })
  decideCall(call, EDITOR, again, 'reject', 'Нет')
  assert.equal(notes[1].body, '«Субботник». Причина: Нет. Можно доработать и отправить снова.')
  const own = propose(call, EDITOR)
  decideCall(call, EDITOR, own, 'approve')
  assert.equal(notes.length, 2) // редактор проверил своё
})

test('антиспам: 4-е открытое — 429, после approve можно, 6-е за 24 ч — 429, через сутки можно', () => {
  const { call, after } = setup()
  const first = [propose(call, AUTHOR), propose(call, AUTHOR), propose(call, AUTHOR)]
  status(() => propose(call, AUTHOR), 429)
  for (const item of first) decideCall(call, EDITOR, item, 'approve')
  const more = [propose(call, AUTHOR), propose(call, AUTHOR)] // создано 5 за сутки
  for (const item of more) decideCall(call, EDITOR, item, 'approve')
  status(() => propose(call, AUTHOR), 429)
  after(25)
  assert.ok(propose(call, AUTHOR))
})

test('антиспам: у «Ани С.» в демо уже два открытых — третье можно, четвёртое нет', () => {
  const { call } = setup()
  assert.ok(propose(call, ANI))
  status(() => propose(call, ANI), 429)
})

test('повторная подача отклонённого сверх лимита открытых — 429', () => {
  const { call } = setup()
  const denis = mine(call, DENIS)[0] // rejected из демо
  const a = propose(call, DENIS)
  propose(call, DENIS)
  propose(call, DENIS)
  status(() => call('PATCH /modules/news/proposals/:id', { token: DENIS, params: { id: denis.id }, body: {} }), 429)
  decideCall(call, EDITOR, a, 'reject')
  assert.equal(call('PATCH /modules/news/proposals/:id', { token: DENIS, params: { id: denis.id }, body: {} }).status, 'pending')
})

test('бейдж меню: число pending только редактору', () => {
  const { call, moduleBadges } = setup()
  assert.deepEqual(moduleBadges(userFromToken(EDITOR)), { news: 1 })
  assert.deepEqual(moduleBadges(userFromToken(ADMIN)), { news: 1 })
  assert.deepEqual(moduleBadges(userFromToken(AUTHOR)), {})
  assert.deepEqual(moduleBadges(userFromToken(VIEWER)), {})
  decideCall(call, EDITOR, review(call).items[0], 'approve')
  assert.deepEqual(moduleBadges(userFromToken(EDITOR)), {})
})
