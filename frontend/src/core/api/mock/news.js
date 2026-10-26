// Mock модуля «Новости» (демо-режим): тот же контракт и права, что у бэкенда (docs/TZ-news.md, раздел «Эндпоинты»).
// Журнал в mock не ведётся. Демо-данные заданы относительно now(); все люди и тексты вымышленные.
import { ApiError } from '../client.js'
import { canSeeData } from '../../access.js'
import { data as hub } from './data.js'

const HOUR = 3600 * 1000
const FEED_LIMIT = 5
const ZONE = /(Z|[+-]\d{2}:\d{2})$/
const ANSWERS = ['yes', 'maybe', 'no']
const TABS = ['current', 'past', 'drafts']
const PATCH_FIELDS = ['title', 'body', 'place', 'startsAt', 'endsAt', 'pinned', 'rsvpEnabled', 'rsvpDeadline', 'rsvpNamesPublic', 'status', 'archived']
const NEWS_NULL = ['place', 'startsAt', 'endsAt', 'rsvpDeadline']
const NEWS_FALSE = ['rsvpEnabled', 'rsvpNamesPublic']

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const time = (iso) => new Date(iso).getTime()

// deps: userFromToken(token) — 401 без токена; accessTo(user, moduleId); isEditor(user); errors — тексты ошибок модуля
// (strings.errors из реестра: ядро не импортирует modules/news); now — для тестов
export function createNewsHandlers({ userFromToken, accessTo, isEditor, errors: err, now = () => new Date() }) {
  const at = (hours, base = now()) => new Date(base.getTime() + hours * HOUR).toISOString()
  let nextItemId = 1
  let nextBannerId = 1
  const items = []
  const rsvps = [] // { itemId, userId, answer }
  const banners = [] // { id, text, active, endsAt }

  const add = (item) => {
    const row = {
      kind: 'news', body: '', place: null, startsAt: null, endsAt: null, pinned: false, status: 'published', archived: false,
      rsvpEnabled: false, rsvpDeadline: null, rsvpNamesPublic: false, publishedAt: null, ...item,
    }
    row.id = nextItemId++
    row.updatedAt = row.updatedAt ?? row.publishedAt ?? at(0)
    items.push(row)
    return row
  }
  const answer = (itemId, userId, value) => rsvps.push({ itemId, userId, answer: value })

  // ---- демо-данные ----
  const picnic = add({
    kind: 'event', title: 'Выезд на природу', place: 'Дилижан', pinned: true, publishedAt: at(-48),
    startsAt: at(7 * 24), endsAt: at(7 * 24 + 10), rsvpEnabled: true, rsvpDeadline: at(5 * 24), rsvpNamesPublic: true,
    body: 'Сбор у офиса в 08:30\nАвтобус в 09:00\nВозврат около 19:00\nВзять: удобную обувь, дождевик',
  })
  const training = add({
    kind: 'event', title: 'Обучение по новому складскому учёту', place: 'Переговорная 2', publishedAt: at(-24),
    startsAt: at(3 * 24), endsAt: at(3 * 24 + 2), rsvpEnabled: true, rsvpNamesPublic: false,
    body: 'Короткая встреча для всех, кто работает со складом.',
  })
  add({ kind: 'event', title: 'Командный завтрак', place: 'Кухня', publishedAt: at(-10 * 24), startsAt: at(-3 * 24), endsAt: at(-3 * 24 + 2) })
  add({ kind: 'news', title: 'Новая политика отпусков', pinned: true, publishedAt: at(-5 * 24), body: 'С ноября заявки на отпуск подаются через раздел «Отпуск» в профиле.' })
  add({ kind: 'news', title: 'Обновили карту команды', publishedAt: at(-2 * 24), body: 'В карте появились календарь отпусков и дни рождения.' })
  add({ kind: 'news', title: 'Итоги месяца', publishedAt: at(-24), body: 'Спасибо всем за работу! Подробности — на планёрке в понедельник.' })
  add({ kind: 'news', title: 'Черновик объявления', status: 'draft', body: 'Текст ещё не готов.' })
  add({ kind: 'news', title: 'Старая новость из архива', archived: true, publishedAt: at(-60 * 24), body: 'Эта запись убрана в архив.' })
  for (const [userId, value] of [[3, 'yes'], [4, 'yes'], [6, 'maybe'], [8, 'no'], [10, 'yes']]) answer(picnic.id, userId, value)
  for (const [userId, value] of [[3, 'yes'], [9, 'maybe']]) answer(training.id, userId, value)
  banners.push({ id: nextBannerId++, text: 'В субботу офис закрыт: плановые работы в здании', active: true, endsAt: at(5 * 24) })

  // ---- представление ----
  const isPast = (r, n) => r.kind === 'event' && time(r.endsAt ?? r.startsAt) < n
  const rsvpOpen = (r, n) =>
    r.status === 'published' && !r.archived && !isPast(r, n) && n < time(r.rsvpDeadline ?? r.startsAt)
  const activeUser = (id) => hub.users.some((u) => u.id === id && u.is_active)

  function itemOut(r, user, editor, n) {
    let rsvp = null
    if (r.rsvpEnabled) {
      const counts = { yes: 0, maybe: 0, no: 0 }
      for (const a of rsvps) if (a.itemId === r.id && activeUser(a.userId)) counts[a.answer] += 1
      rsvp = {
        open: rsvpOpen(r, n),
        counts,
        myAnswer: rsvps.find((a) => a.itemId === r.id && a.userId === user.id)?.answer ?? null,
        canSeeNames: editor || r.rsvpNamesPublic,
      }
    }
    return { ...r, rsvp }
  }

  const current = (r, n) => r.status === 'published' && !r.archived && (r.kind === 'news' || time(r.endsAt ?? r.startsAt) >= n)
  const byStart = (a, b) => time(a.startsAt) - time(b.startsAt) || a.id - b.id
  const byPublished = (a, b) => time(b.publishedAt) - time(a.publishedAt) || b.id - a.id
  const pinnedFirst = (cmp) => (a, b) => Number(b.pinned) - Number(a.pinned) || cmp(a, b)

  const TAB_FILTERS = {
    current: (r, n) => current(r, n),
    past: (r, n) => r.status === 'published' && (r.archived || isPast(r, n)),
    drafts: (r) => r.status === 'draft',
  }
  const TAB_ORDER = {
    current: (a, b) =>
      Number(b.pinned) - Number(a.pinned) || Number(a.kind === 'news') - Number(b.kind === 'news') ||
      (a.startsAt && b.startsAt ? time(a.startsAt) - time(b.startsAt) : a.startsAt ? -1 : b.startsAt ? 1 : 0) || byPublished(a, b),
    past: (a, b) => time(b.startsAt ?? b.publishedAt) - time(a.startsAt ?? a.publishedAt) || b.id - a.id,
    drafts: (a, b) => time(b.updatedAt) - time(a.updatedAt) || b.id - a.id,
  }

  // ---- права ----
  function reader(token) {
    const user = userFromToken(token)
    const editor = isEditor(user)
    if (!editor && !canSeeData(accessTo(user, 'news'))) throw new ApiError(403, err.forbidden)
    return { user, editor }
  }

  function editorOf(token) {
    const user = userFromToken(token)
    if (!isEditor(user)) throw new ApiError(403, err.forbidden)
    return user
  }

  const findItem = (id) => items.find((r) => r.id === Number(id))

  // ---- валидация ----
  const str = (v, min, max) => {
    if (typeof v !== 'string') throw new ApiError(422, err.invalid)
    const s = v.trim()
    if (s.length < min || s.length > max) throw new ApiError(422, err.invalid)
    return s
  }
  const dateOrNull = (v) => {
    if (v === null) return null
    if (typeof v !== 'string' || !ZONE.test(v) || Number.isNaN(time(v))) throw new ApiError(422, err.invalid)
    return new Date(v).toISOString()
  }
  const bool = (v) => {
    if (typeof v !== 'boolean') throw new ApiError(422, err.invalid)
    return v
  }
  const oneOf = (v, list) => {
    if (!list.includes(v)) throw new ApiError(422, err.invalid)
    return v
  }
  const placeOrNull = (v) => (v === null ? null : str(v, 0, 200) || null)

  // Значения по типам; null допустим только у необязательных полей
  const PARSERS = {
    title: (v) => str(v, 1, 200),
    body: (v) => str(v, 0, 5000),
    place: placeOrNull,
    startsAt: dateOrNull,
    endsAt: dateOrNull,
    pinned: bool,
    rsvpEnabled: bool,
    rsvpDeadline: dateOrNull,
    rsvpNamesPublic: bool,
    status: (v) => oneOf(v, ['draft', 'published']),
    archived: bool,
  }

  function validateState(s) {
    if (s.kind === 'news') {
      if (NEWS_NULL.some((f) => s[f] !== null) || NEWS_FALSE.some((f) => s[f])) throw new ApiError(422, err.newsFields)
      return
    }
    if (s.startsAt === null) throw new ApiError(422, err.startRequired)
    if (s.endsAt !== null && time(s.endsAt) < time(s.startsAt)) throw new ApiError(422, err.endBeforeStart)
    if (s.rsvpDeadline !== null && time(s.rsvpDeadline) > time(s.startsAt)) throw new ApiError(422, err.deadlineAfterStart)
  }

  const pageParam = (raw, fallback, min, max) => {
    if (raw === undefined) return fallback
    const n = Number(raw)
    if (raw === '' || !Number.isInteger(n) || n < min || n > max) throw new ApiError(422, err.invalid)
    return n
  }

  const bannerOut = (b) => (b ? { id: b.id, text: b.text, endsAt: b.endsAt } : null)

  const handlers = {
    'GET /modules/news/feed': ({ token }) => {
      const { user, editor } = reader(token)
      const n = now().getTime()
      const pub = items.filter((r) => r.status === 'published' && !r.archived)
      const events = pub.filter((r) => r.kind === 'event' && time(r.endsAt ?? r.startsAt) >= n).sort(pinnedFirst(byStart)).slice(0, FEED_LIMIT)
      const news = pub.filter((r) => r.kind === 'news').sort(pinnedFirst(byPublished)).slice(0, FEED_LIMIT)
      return { events: events.map((r) => itemOut(r, user, editor, n)), news: news.map((r) => itemOut(r, user, editor, n)) }
    },

    'GET /modules/news/banner': ({ token }) => {
      reader(token)
      const n = now().getTime()
      return { banner: bannerOut(banners.find((b) => b.active && (b.endsAt === null || time(b.endsAt) > n))) }
    },

    'POST /modules/news/items/:id/rsvp': ({ token, params, body }) => {
      const { user, editor } = reader(token)
      const r = findItem(params.id)
      if (!r || r.status !== 'published') throw new ApiError(404, err.notFound)
      const value = oneOf(body?.answer, ANSWERS)
      const n = now().getTime()
      if (r.kind !== 'event' || !r.rsvpEnabled) throw new ApiError(409, err.rsvpOff)
      if (!rsvpOpen(r, n)) throw new ApiError(409, err.rsvpClosed)
      const existing = rsvps.find((a) => a.itemId === r.id && a.userId === user.id)
      if (existing) existing.answer = value
      else answer(r.id, user.id, value)
      return itemOut(r, user, editor, n)
    },

    'GET /modules/news/items/:id/responses': ({ token, params }) => {
      const { editor } = reader(token)
      const r = findItem(params.id)
      if (!r || (r.status !== 'published' && !editor)) throw new ApiError(404, err.notFound)
      if (!editor && !(r.rsvpEnabled && r.rsvpNamesPublic)) throw new ApiError(403, err.forbidden)
      const out = { yes: [], maybe: [], no: [] }
      const rows = rsvps
        .filter((a) => a.itemId === r.id && activeUser(a.userId))
        .map((a) => ({ a, name: hub.users.find((u) => u.id === a.userId).full_name }))
        .sort((x, y) => x.name.localeCompare(y.name, 'ru') || x.a.userId - y.a.userId)
      for (const { a, name } of rows) out[a.answer].push({ userId: a.userId, name, updatedAt: now().toISOString() })
      return out
    },

    'GET /modules/news/items': ({ token, query }) => {
      const user = editorOf(token)
      if (!TABS.includes(query.tab)) throw new ApiError(422, err.invalid)
      const limit = pageParam(query.limit, 20, 1, 100)
      const offset = pageParam(query.offset, 0, 0, Number.MAX_SAFE_INTEGER)
      const n = now().getTime()
      const all = items.filter((r) => TAB_FILTERS[query.tab](r, n)).sort(TAB_ORDER[query.tab])
      return { items: all.slice(offset, offset + limit).map((r) => itemOut(r, user, true, n)), total: all.length }
    },

    'POST /modules/news/items': ({ token, body }) => {
      const user = editorOf(token)
      if (!isObject(body)) throw new ApiError(422, err.invalid)
      const state = {
        kind: oneOf(body.kind, ['news', 'event']), title: null, body: '', place: null, startsAt: null, endsAt: null, pinned: false,
        status: 'draft', rsvpEnabled: false, rsvpDeadline: null, rsvpNamesPublic: false,
      }
      if (!('title' in body)) throw new ApiError(422, err.invalid)
      for (const field of Object.keys(PARSERS)) if (field in body && field !== 'archived') state[field] = PARSERS[field](body[field])
      validateState(state)
      const stamp = now().toISOString()
      const row = add({ ...state, publishedAt: state.status === 'published' ? stamp : null, updatedAt: stamp })
      return itemOut(row, user, true, now().getTime())
    },

    'PATCH /modules/news/items/:id': ({ token, params, body }) => {
      const user = editorOf(token)
      const r = findItem(params.id)
      if (!r) throw new ApiError(404, err.notFound)
      if (!isObject(body) || Object.keys(body).some((k) => !PATCH_FIELDS.includes(k))) throw new ApiError(422, err.invalid)
      const state = { ...r }
      for (const [field, value] of Object.entries(body)) {
        // title, body, pinned, rsvp*, status, archived — без null; place и даты допускают null
        if (value === null && !['place', 'startsAt', 'endsAt', 'rsvpDeadline'].includes(field)) throw new ApiError(422, err.invalid)
        state[field] = PARSERS[field](value)
      }
      validateState(state)
      const changed = Object.keys(body).some((f) => state[f] !== r[f])
      if (!changed) return itemOut(r, user, true, now().getTime())
      if (state.status === 'published' && r.publishedAt === null) state.publishedAt = now().toISOString()
      Object.assign(r, state, { updatedAt: now().toISOString() })
      return itemOut(r, user, true, now().getTime())
    },

    'POST /modules/news/items/:id/delete': ({ token, params }) => {
      editorOf(token)
      const index = items.findIndex((r) => r.id === Number(params.id))
      if (index === -1) throw new ApiError(404, err.notFound)
      const [removed] = items.splice(index, 1)
      for (let i = rsvps.length - 1; i >= 0; i -= 1) if (rsvps[i].itemId === removed.id) rsvps.splice(i, 1)
      return { ok: true }
    },

    'POST /modules/news/banner': ({ token, body }) => {
      editorOf(token)
      const text = str(body?.text, 1, 300)
      const endsAt = body?.endsAt === undefined ? null : dateOrNull(body.endsAt)
      if (endsAt !== null && time(endsAt) <= now().getTime()) throw new ApiError(422, err.bannerPast)
      // Правило id: тот же текст — та же строка (обновляется только срок), новый текст — новая строка с новым id
      let banner = banners.find((b) => b.active && b.text === text)
      if (banner) banner.endsAt = endsAt
      else {
        for (const b of banners) b.active = false
        banner = { id: nextBannerId++, text, active: true, endsAt }
        banners.push(banner)
      }
      return { banner: bannerOut(banner) }
    },

    'POST /modules/news/banner/off': ({ token }) => {
      editorOf(token)
      for (const b of banners) b.active = false
      return { banner: null }
    },
  }

  return { handlers }
}
