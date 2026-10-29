// Mock модуля «Новости» (демо-режим): тот же контракт и права, что у бэкенда (docs/TZ-news.md, раздел «Эндпоинты»;
// предложка и модерация — docs/TZ-news-moderation.md).
// Журнал в mock не ведётся. Демо-данные заданы относительно now(); все люди и тексты вымышленные.
import { ApiError } from '../client.js'
import { canSeeData } from '../../access.js'
import { data as hub } from './data.js'

const HOUR = 3600 * 1000
const FEED_LIMIT = 5
const ZONE = /(Z|[+-]\d{2}:\d{2})$/
const ANSWERS = ['yes', 'maybe', 'no']
const TABS = ['current', 'past', 'drafts', 'review']
const PROPOSAL_OPEN_LIMIT = 3
const PROPOSAL_DAILY_LIMIT = 5
const PROPOSAL_LINK = '/profile?section=proposals'
const MINE_LIMIT = 50
// Служебные поля строки: наружу не отдаются, автор и сведения о проверке — в ключе review
const INTERNAL_FIELDS = ['createdBy', 'createdAt', 'submittedAt', 'reviewComment', 'reviewedAt', 'sort']
// Поля предложения автора (без pinned, status, archived; kind — только при создании)
const PROPOSAL_FIELDS = ['title', 'body', 'place', 'startsAt', 'endsAt', 'color', 'rsvpEnabled', 'rsvpDeadline', 'rsvpNamesPublic']
const PATCH_FIELDS = ['title', 'body', 'place', 'startsAt', 'endsAt', 'pinned', 'color', 'rsvpEnabled', 'rsvpDeadline', 'rsvpNamesPublic', 'status', 'archived']
// Ключи цветов записи (зеркало бэкенда и modules/news/lib/news.js: ядро не импортирует modules/news)
const COLORS = ['red', 'green', 'yellow', 'blue', 'pink', 'gray']
const NEWS_NULL = ['place', 'startsAt', 'endsAt', 'rsvpDeadline']
const NEWS_FALSE = ['rsvpEnabled', 'rsvpNamesPublic']

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const time = (iso) => new Date(iso).getTime()

// deps: userFromToken(token) — 401 без токена; accessTo(user, moduleId); isEditor(user); errors — тексты ошибок модуля
// (strings.errors из реестра: ядро не импортирует modules/news); notify(userIds, { kind, title, body, link }) — уведомления автору;
// userById(id) -> пользователь | null (не бросает: автор мог быть удалён); now — для тестов
export function createNewsHandlers({ userFromToken, accessTo, isEditor, notify, userById, errors: err, now = () => new Date() }) {
  const at = (hours, base = now()) => new Date(base.getTime() + hours * HOUR).toISOString()
  let nextItemId = 1
  let nextBannerId = 1
  const items = []
  const rsvps = [] // { itemId, userId, answer }
  const banners = [] // { id, text, active, endsAt }

  const add = (item) => {
    const row = {
      kind: 'news', body: '', place: null, startsAt: null, endsAt: null, pinned: false, color: null, status: 'published', archived: false,
      rsvpEnabled: false, rsvpDeadline: null, rsvpNamesPublic: false, publishedAt: null,
      createdBy: null, submittedAt: null, reviewComment: null, reviewedAt: null, sort: null, ...item,
    }
    row.id = nextItemId++
    row.updatedAt = row.updatedAt ?? row.publishedAt ?? at(0)
    row.createdAt = row.createdAt ?? row.updatedAt
    items.push(row)
    return row
  }
  const answer = (itemId, userId, value) => rsvps.push({ itemId, userId, answer: value })

  // ---- демо-данные ----
  const picnic = add({
    kind: 'event', title: 'Выезд на природу', place: 'Дилижан', pinned: true, color: 'green', publishedAt: at(-48),
    startsAt: at(7 * 24), endsAt: at(7 * 24 + 10), rsvpEnabled: true, rsvpDeadline: at(5 * 24), rsvpNamesPublic: true,
    body: 'Сбор у офиса в 08:30\nАвтобус в 09:00\nВозврат около 19:00\nВзять: удобную обувь, дождевик',
  })
  const training = add({
    kind: 'event', title: 'Обучение по новому складскому учёту', place: 'Переговорная 2', color: 'blue', publishedAt: at(-24),
    startsAt: at(3 * 24), endsAt: at(3 * 24 + 2), rsvpEnabled: true, rsvpNamesPublic: false,
    body: 'Короткая встреча для всех, кто работает со складом.',
  })
  add({ kind: 'event', title: 'Командный завтрак', place: 'Кухня', publishedAt: at(-10 * 24), startsAt: at(-3 * 24), endsAt: at(-3 * 24 + 2) })
  add({ kind: 'news', title: 'Новая политика отпусков', pinned: true, color: 'yellow', publishedAt: at(-5 * 24), body: 'С ноября заявки на отпуск подаются через раздел «Отпуск» в профиле.' })
  add({ kind: 'news', title: 'Обновили карту команды', publishedAt: at(-2 * 24), body: 'В карте появились календарь отпусков и дни рождения.' })
  add({ kind: 'news', title: 'Итоги месяца', pinned: true, color: 'pink', publishedAt: at(-24), body: 'Спасибо всем за работу! Подробности — на планёрке в понедельник.' })
  add({ kind: 'news', title: 'Черновик объявления', status: 'draft', body: 'Текст ещё не готов.' })
  add({ kind: 'news', title: 'Старая новость из архива', archived: true, publishedAt: at(-60 * 24), body: 'Эта запись убрана в архив.' })
  // Предложения сотрудников: на проверке, на доработке, отклонено, опубликовано (3 — «Ани С.», 10 — «Кравцов Денис»)
  add({
    kind: 'news', title: 'Предлагаю завести общий чат для склада', status: 'pending', createdBy: 3, color: 'blue', submittedAt: at(-5), createdAt: at(-30), updatedAt: at(-5),
    body: 'Сейчас вопросы по приёмке теряются в личных сообщениях. Предлагаю один общий чат.',
  })
  add({
    kind: 'event', title: 'Пятничный киноклуб', place: 'Переговорная 1', status: 'needs_changes', createdBy: 3, submittedAt: at(-28), createdAt: at(-52),
    startsAt: at(9 * 24), reviewComment: 'Добавьте время окончания и уточните, нужна ли запись', reviewedAt: at(-20), updatedAt: at(-20),
    body: 'Смотрим короткое кино после работы.',
  })
  add({
    kind: 'news', title: 'Скидка на кофе для сотрудников', status: 'rejected', createdBy: 10, submittedAt: at(-30), createdAt: at(-60),
    reviewComment: 'Нет договорённости с кофейней, вопрос не в нашей компетенции', reviewedAt: at(-26), updatedAt: at(-26),
    body: 'Хорошо бы договориться со столовой на первом этаже о скидке.',
  })
  add({
    kind: 'news', title: 'Велопарковка во дворе', createdBy: 3, submittedAt: at(-6 * 24), createdAt: at(-6 * 24), publishedAt: at(-4 * 24), reviewedAt: at(-4 * 24),
    body: 'Во дворе появились стойки для велосипедов.',
  })
  for (const [userId, value] of [[3, 'yes'], [4, 'yes'], [6, 'maybe'], [8, 'no'], [10, 'yes']]) answer(picnic.id, userId, value)
  for (const [userId, value] of [[3, 'yes'], [9, 'maybe']]) answer(training.id, userId, value)
  banners.push({ id: nextBannerId++, text: 'В субботу офис закрыт: плановые работы в здании', active: true, endsAt: at(5 * 24) })

  // ---- представление ----
  const isPast = (r, n) => r.kind === 'event' && time(r.endsAt ?? r.startsAt) < n
  const rsvpOpen = (r, n) =>
    r.status === 'published' && !r.archived && !isPast(r, n) && n < time(r.rsvpDeadline ?? r.startsAt)
  const activeUser = (id) => hub.users.some((u) => u.id === id && u.is_active)

  // withReview: добавить ключ review (списки редактора и собственные записи автора); служебные поля наружу не отдаются
  function itemOut(r, user, editor, n, withReview = false) {
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
    const out = { ...r, rsvp }
    for (const key of INTERNAL_FIELDS) delete out[key]
    if (withReview) {
      const author = userById(r.createdBy)
      out.review = r.submittedAt
        ? { author: author ? { id: author.id, name: author.full_name } : null, submittedAt: r.submittedAt, reviewComment: r.reviewComment, reviewedAt: r.reviewedAt }
        : null
    }
    return out
  }

  const current = (r, n) => r.status === 'published' && !r.archived && (r.kind === 'news' || time(r.endsAt ?? r.startsAt) >= n)
  const byStart = (a, b) => time(a.startsAt) - time(b.startsAt) || a.id - b.id
  const byPublished = (a, b) => time(b.publishedAt) - time(a.publishedAt) || b.id - a.id
  // Ручной порядок — только среди закреплённых (sort; без него — после упорядоченных)
  const bySort = (a, b) => (a.pinned && b.pinned ? (a.sort ?? Number.MAX_SAFE_INTEGER) - (b.sort ?? Number.MAX_SAFE_INTEGER) : 0)
  const pinnedFirst = (cmp) => (a, b) => Number(b.pinned) - Number(a.pinned) || bySort(a, b) || cmp(a, b)

  const TAB_FILTERS = {
    current: (r, n) => current(r, n),
    past: (r, n) => (r.status === 'published' && (r.archived || isPast(r, n))) || r.status === 'rejected',
    drafts: (r) => r.status === 'draft',
    review: (r) => r.status === 'pending' || r.status === 'needs_changes',
  }
  const TAB_ORDER = {
    current: (a, b) =>
      Number(b.pinned) - Number(a.pinned) || Number(a.kind === 'news') - Number(b.kind === 'news') || bySort(a, b) ||
      (a.startsAt && b.startsAt ? time(a.startsAt) - time(b.startsAt) : a.startsAt ? -1 : b.startsAt ? 1 : 0) || byPublished(a, b),
    past: (a, b) => time(b.startsAt ?? b.publishedAt ?? b.reviewedAt) - time(a.startsAt ?? a.publishedAt ?? a.reviewedAt) || b.id - a.id,
    drafts: (a, b) => time(b.updatedAt) - time(a.updatedAt) || b.id - a.id,
    review: (a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || time(a.submittedAt) - time(b.submittedAt) || a.id - b.id,
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
  const pendingCount = () => items.filter((r) => r.status === 'pending').length

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
    color: (v) => (v === null ? null : oneOf(v, COLORS)),
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

  const expectedAt = (v) => {
    if (v === null || v === undefined) throw new ApiError(422, err.invalid)
    return dateOrNull(v)
  }

  // Антиспам автора: не больше 3 открытых (pending + needs_changes) и 5 новых за 24 часа
  const openCount = (user) => items.filter((r) => r.createdBy === user.id && r.submittedAt && (r.status === 'pending' || r.status === 'needs_changes')).length
  const checkOpenLimit = (user) => {
    if (openCount(user) >= PROPOSAL_OPEN_LIMIT) throw new ApiError(429, err.openLimit)
  }
  const checkDailyLimit = (user, n) => {
    const sent = items.filter((r) => r.createdBy === user.id && r.submittedAt && time(r.createdAt) > n - 24 * HOUR).length
    if (sent >= PROPOSAL_DAILY_LIMIT) throw new ApiError(429, err.dailyLimit)
  }

  // Решение редактора по предложению из pending; уведомление — только автору (не себе, не неактивному — это проверяет notify)
  function decide(token, params, body, action) {
    const user = editorOf(token)
    if (!isObject(body)) throw new ApiError(422, err.invalid)
    const expected = expectedAt(body.expectedUpdatedAt)
    const comment = action === 'approve' ? null : str(body.comment, 1, 1000)
    const r = findItem(params.id)
    if (!r) throw new ApiError(404, err.notFound)
    if (r.status !== 'pending') throw new ApiError(409, err.alreadyReviewed)
    if (time(r.updatedAt) !== time(expected)) throw new ApiError(409, err.stale)
    const stamp = now().toISOString()
    const target = { approve: 'published', return: 'needs_changes', reject: 'rejected' }[action]
    Object.assign(r, { status: target, reviewedAt: stamp, updatedAt: stamp })
    if (comment !== null) r.reviewComment = comment
    if (action === 'approve') r.publishedAt = r.publishedAt ?? stamp
    if (r.createdBy !== null && r.createdBy !== user.id) {
      const text = {
        approve: { title: 'Ваша новость опубликована', body: r.title },
        return: { title: 'Новость нужно доработать', body: `«${r.title}»: ${comment}` },
        reject: { title: 'Новость отклонена', body: `«${r.title}». Причина: ${comment}. Можно доработать и отправить снова.` },
      }[action]
      notify([r.createdBy], { kind: 'news_review', ...text, link: PROPOSAL_LINK })
    }
    return itemOut(r, user, true, now().getTime(), true)
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
      return { items: all.slice(offset, offset + limit).map((r) => itemOut(r, user, true, n, true)), total: all.length }
    },

    'POST /modules/news/items': ({ token, body }) => {
      const user = editorOf(token)
      if (!isObject(body)) throw new ApiError(422, err.invalid)
      const state = {
        kind: oneOf(body.kind, ['news', 'event']), title: null, body: '', place: null, startsAt: null, endsAt: null, pinned: false, color: null,
        status: 'draft', rsvpEnabled: false, rsvpDeadline: null, rsvpNamesPublic: false,
      }
      if (!('title' in body)) throw new ApiError(422, err.invalid)
      for (const field of Object.keys(PARSERS)) if (field in body && field !== 'archived') state[field] = PARSERS[field](body[field])
      validateState(state)
      const stamp = now().toISOString()
      const row = add({ ...state, publishedAt: state.status === 'published' ? stamp : null, updatedAt: stamp, createdBy: user.id })
      return itemOut(row, user, true, now().getTime(), true)
    },

    'PATCH /modules/news/items/:id': ({ token, params, body }) => {
      const user = editorOf(token)
      const r = findItem(params.id)
      if (!r) throw new ApiError(404, err.notFound)
      if (!isObject(body) || Object.keys(body).some((k) => !PATCH_FIELDS.includes(k))) throw new ApiError(422, err.invalid)
      // Обход модерации закрыт: needs_changes / rejected у автора; pending — только содержимое
      if (r.status === 'needs_changes' || r.status === 'rejected') throw new ApiError(409, err.atAuthor)
      if (r.status === 'pending' && ('status' in body || 'archived' in body)) throw new ApiError(409, err.useReview)
      const state = { ...r }
      for (const [field, value] of Object.entries(body)) {
        // title, body, pinned, rsvp*, status, archived — без null; place, color и даты допускают null
        if (value === null && !['place', 'color', 'startsAt', 'endsAt', 'rsvpDeadline'].includes(field)) throw new ApiError(422, err.invalid)
        state[field] = PARSERS[field](value)
      }
      validateState(state)
      const changed = Object.keys(body).some((f) => state[f] !== r[f])
      if (!changed) return itemOut(r, user, true, now().getTime(), true)
      if (state.pinned !== r.pinned) state.sort = null // смена закрепления сбрасывает ручной порядок
      if (state.status === 'published' && r.publishedAt === null) state.publishedAt = now().toISOString()
      Object.assign(r, state, { updatedAt: now().toISOString() })
      return itemOut(r, user, true, now().getTime(), true)
    },

    // Ручной порядок закреплённых одного типа: ids должен точно совпасть с текущим набором закреплённых
    'POST /modules/news/pinned-order': ({ token, body }) => {
      editorOf(token)
      if (!isObject(body) || !['news', 'event'].includes(body.kind) || !Array.isArray(body.ids) || !body.ids.every(Number.isInteger)) {
        throw new ApiError(422, err.invalid)
      }
      const n = now().getTime()
      const pinned = items.filter((r) => r.pinned && r.kind === body.kind && current(r, n)).map((r) => r.id)
      if (new Set(body.ids).size !== body.ids.length || body.ids.length !== pinned.length || !body.ids.every((id) => pinned.includes(id))) {
        throw new ApiError(409, err.pinnedChanged)
      }
      body.ids.forEach((id, index) => {
        findItem(id).sort = index
      })
      return { ok: true }
    },

    'POST /modules/news/items/:id/delete': ({ token, params }) => {
      editorOf(token)
      const index = items.findIndex((r) => r.id === Number(params.id))
      if (index === -1) throw new ApiError(404, err.notFound)
      const [removed] = items.splice(index, 1)
      for (let i = rsvps.length - 1; i >= 0; i -= 1) if (rsvps[i].itemId === removed.id) rsvps.splice(i, 1)
      return { ok: true }
    },

    'GET /modules/news/proposals/mine': ({ token }) => {
      const { user, editor } = reader(token)
      const n = now().getTime()
      const own = items
        .filter((r) => r.createdBy === user.id && r.submittedAt)
        .sort((a, b) => time(b.createdAt) - time(a.createdAt) || b.id - a.id)
        .slice(0, MINE_LIMIT)
      return { items: own.map((r) => itemOut(r, user, editor, n, true)) }
    },

    'POST /modules/news/proposals': ({ token, body }) => {
      const { user, editor } = reader(token)
      if (!isObject(body) || Object.keys(body).some((k) => k !== 'kind' && !PROPOSAL_FIELDS.includes(k))) throw new ApiError(422, err.invalid)
      const state = {
        kind: oneOf(body.kind, ['news', 'event']), title: null, body: '', place: null, startsAt: null, endsAt: null, pinned: false, color: null,
        status: 'pending', rsvpEnabled: false, rsvpDeadline: null, rsvpNamesPublic: false,
      }
      if (!('title' in body)) throw new ApiError(422, err.invalid)
      for (const field of PROPOSAL_FIELDS) if (field in body) state[field] = PARSERS[field](body[field])
      validateState(state)
      const n = now()
      checkOpenLimit(user)
      checkDailyLimit(user, n.getTime())
      const stamp = n.toISOString()
      const row = add({ ...state, createdBy: user.id, submittedAt: stamp, createdAt: stamp, updatedAt: stamp })
      return itemOut(row, user, editor, n.getTime(), true)
    },

    'PATCH /modules/news/proposals/:id': ({ token, params, body }) => {
      const { user, editor } = reader(token)
      if (!isObject(body) || Object.keys(body).some((k) => !PROPOSAL_FIELDS.includes(k))) throw new ApiError(422, err.invalid)
      const r = findItem(params.id)
      if (!r || r.createdBy !== user.id || !r.submittedAt) throw new ApiError(404, err.notFound)
      if (!['pending', 'needs_changes', 'rejected'].includes(r.status)) throw new ApiError(409, err.alreadyPublished)
      const state = { ...r }
      for (const [field, value] of Object.entries(body)) {
        if (value === null && !['place', 'color', 'startsAt', 'endsAt', 'rsvpDeadline'].includes(field)) throw new ApiError(422, err.invalid)
        state[field] = PARSERS[field](value)
      }
      validateState(state)
      const n = now()
      const changed = Object.keys(body).some((f) => state[f] !== r[f])
      if (r.status === 'pending' && !changed) return itemOut(r, user, editor, n.getTime(), true)
      if (r.status === 'rejected') checkOpenLimit(user)
      const stamp = n.toISOString()
      Object.assign(r, state, { status: 'pending', submittedAt: r.status === 'pending' ? r.submittedAt : stamp, updatedAt: stamp })
      return itemOut(r, user, editor, n.getTime(), true)
    },

    'POST /modules/news/items/:id/approve': ({ token, params, body }) => decide(token, params, body, 'approve'),
    'POST /modules/news/items/:id/return': ({ token, params, body }) => decide(token, params, body, 'return'),
    'POST /modules/news/items/:id/reject': ({ token, params, body }) => decide(token, params, body, 'reject'),

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

  // Бейдж пункта меню «Редактор новостей»: число предложений на проверке (только редактору)
  const moduleBadges = (user) => {
    const n = isEditor(user) ? pendingCount() : 0
    return n > 0 ? { news: n } : {}
  }

  return { handlers, moduleBadges }
}
