// Mock модуля «Обратная связь» (демо-режим): тот же контракт, права и коды, что у бэкенда (docs/TZ-feedback.md, раздел «Эндпойнты»).
// Текст хранится открыто (демо). У анонимных записей автор не хранится: ни в записи, ни в журнале; лимит отправок ведётся по хешу с солью,
// созданной при запуске, — id пользователя в хранилище не попадает. Журнал в mock не ведётся.
import { ApiError } from '../client.js'
import { canSeeData } from '../../access.js'
import { data as hub } from './data.js'

const KINDS = ['thanks', 'idea', 'complaint', 'other']
const STATUSES = ['new', 'in_progress', 'closed']
// Зеркала бэкенда и modules/feedback/lib/feedback.js: ядро не импортирует modules/feedback
const BODY_LIMIT = 3000
const NOTE_LIMIT = 2000
const DAILY_LIMIT = 10
const WINDOW_MS = 86400 * 1000
const MINE_LIMIT = 50
const NOTIFY = { kind: 'feedback.new', title: 'Новое сообщение обратной связи', body: '', link: '/modules/feedback' }

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const nameOf = (id) => hub.users.find((u) => u.id === id)?.full_name ?? null
const activeLeveled = (id) => hub.users.some((u) => u.id === id && u.is_active && u.access_level && !u.onboarding)

// deps: userFromToken(token) — 401 без токена; accessTo(user, moduleId); isReader(user); readerIds() — id читателей для уведомления;
// notify(userIds, { kind, title, body, link }); errors — тексты ошибок модуля (strings.errors из реестра); now — для тестов
export function createFeedbackHandlers({ userFromToken, accessTo, isReader, readerIds = () => [], notify = () => {}, errors: err, now = () => new Date() }) {
  const messages = []
  let nextId = 1
  const salt = `${Math.random()}${Math.random()}` // только в памяти; при перезагрузке страницы меняется
  const sent = new Map() // хеш(salt, user.id) -> [время отправок, мс]

  const keyOf = (userId) => {
    let h = 2166136261
    for (const ch of `${salt}:${userId}`) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0
    return String(h)
  }
  const reserve = (userId) => {
    const t = now().getTime()
    for (const [k, list] of sent) {
      const fresh = list.filter((x) => t - x < WINDOW_MS)
      if (fresh.length) sent.set(k, fresh)
      else sent.delete(k)
    }
    const key = keyOf(userId)
    const list = sent.get(key) ?? []
    if (list.length >= DAILY_LIMIT) throw new ApiError(429, err.tooMany)
    sent.set(key, [...list, t])
  }

  const add = (fields, at = now()) => {
    const row = {
      id: nextId++, kind: 'other', anonymous: false, authorId: null, contactOk: false, recipientId: null, status: 'new', note: null,
      createdAt: at.toISOString(), updatedAt: at.toISOString(), updatedBy: null, ...fields,
    }
    messages.push(row)
    return row
  }

  // ---- демо-данные: одно анонимное, одна благодарность с адресатом, одно именное ----
  const day = 86400 * 1000
  add({ kind: 'complaint', anonymous: true, body: 'В переговорной на втором этаже постоянно не работает кондиционер, летом там невозможно находиться.' }, new Date(now().getTime() - 2 * day))
  add({ kind: 'thanks', authorId: 3, recipientId: 10, contactOk: true, body: 'Спасибо Денису за помощь с отчётом по закупкам: разобрались за один вечер.' }, new Date(now().getTime() - day))
  add({ kind: 'idea', authorId: 4, status: 'in_progress', note: 'Обсудить с офис-менеджером', updatedBy: 9, body: 'Предлагаю сделать общий календарь бронирования переговорных.' }, new Date(now().getTime() - 3 * day))

  const mineItem = (r) => ({
    id: r.id, kind: r.kind, body: r.body, recipientName: r.recipientId === null ? null : nameOf(r.recipientId),
    contactOk: r.contactOk, status: r.status, createdAt: r.createdAt,
  })
  const readerItem = (r) => ({
    id: r.id, kind: r.kind, body: r.body, anonymous: r.anonymous,
    authorName: r.anonymous ? null : (r.authorId !== null && nameOf(r.authorId)) || err.authorDeleted,
    contactOk: r.contactOk, recipientName: r.recipientId === null ? null : nameOf(r.recipientId),
    status: r.status, note: r.note, createdAt: r.createdAt, updatedAt: r.updatedAt,
    updatedByName: r.updatedBy === null ? null : nameOf(r.updatedBy),
  })

  const senderOf = (token) => {
    const user = userFromToken(token)
    if (!canSeeData(accessTo(user, 'feedback'))) throw new ApiError(403, err.forbidden)
    return user
  }
  const readerOf = (token) => {
    const user = userFromToken(token)
    if (!isReader(user)) throw new ApiError(403, err.forbidden)
    return user
  }

  const handlers = {
    'GET /modules/feedback/people': ({ token }) => {
      const me = senderOf(token)
      return hub.users
        .filter((u) => u.id !== me.id && activeLeveled(u.id))
        .map((u) => ({ id: u.id, fullName: u.full_name }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'))
    },

    'POST /modules/feedback/messages': ({ token, body }) => {
      const user = senderOf(token)
      const allowed = ['kind', 'body', 'anonymous', 'contactOk', 'recipientId']
      if (!isObject(body) || Object.keys(body).some((k) => !allowed.includes(k))) throw new ApiError(422, err.invalid)
      const text = typeof body.body === 'string' ? body.body.trim() : ''
      if (!KINDS.includes(body.kind) || text.length < 1 || text.length > BODY_LIMIT || typeof body.anonymous !== 'boolean') throw new ApiError(422, err.invalid)
      const contactOk = body.contactOk ?? false
      const recipientId = body.recipientId ?? null
      if (typeof contactOk !== 'boolean' || (recipientId !== null && !Number.isInteger(recipientId))) throw new ApiError(422, err.invalid)
      if (body.anonymous && contactOk) throw new ApiError(422, err.contactAnon)
      if (recipientId !== null) {
        if (body.kind !== 'thanks') throw new ApiError(422, err.recipientKind)
        if (recipientId === user.id || !activeLeveled(recipientId)) throw new ApiError(422, err.recipient)
      }
      reserve(user.id) // единственное использование user.id в анонимной ветке: ключ лимита
      const row = add({ kind: body.kind, body: text, anonymous: body.anonymous, authorId: body.anonymous ? null : user.id, contactOk, recipientId })
      notify(readerIds(), NOTIFY) // всем читателям, включая автора-читателя
      return body.anonymous ? { ok: true } : mineItem(row)
    },

    'GET /modules/feedback/mine': ({ token }) => {
      const user = senderOf(token)
      const items = messages.filter((r) => r.authorId === user.id).sort((a, b) => b.id - a.id).slice(0, MINE_LIMIT)
      return { items: items.map(mineItem) }
    },

    'GET /modules/feedback/messages': ({ token, query }) => {
      readerOf(token)
      if (!STATUSES.includes(query.status)) throw new ApiError(422, err.invalid)
      if (query.kind !== undefined && !KINDS.includes(query.kind)) throw new ApiError(422, err.invalid)
      const limit = query.limit === undefined ? 20 : Number(query.limit)
      const offset = query.offset === undefined ? 0 : Number(query.offset)
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw new ApiError(422, err.invalid)
      const scope = messages.filter((r) => query.kind === undefined || r.kind === query.kind)
      const counts = Object.fromEntries(STATUSES.map((s) => [s, scope.filter((r) => r.status === s).length]))
      const rows = scope.filter((r) => r.status === query.status).sort((a, b) => b.id - a.id)
      return { items: rows.slice(offset, offset + limit).map(readerItem), total: rows.length, counts }
    },

    'PATCH /modules/feedback/messages/:id': ({ token, params, body }) => {
      const user = readerOf(token)
      if (!isObject(body) || Object.keys(body).some((k) => !['status', 'note'].includes(k)) || Object.keys(body).length === 0) throw new ApiError(422, err.invalid)
      if ('status' in body && !STATUSES.includes(body.status)) throw new ApiError(422, err.invalid)
      if ('note' in body && body.note !== null && (typeof body.note !== 'string' || body.note.trim().length > NOTE_LIMIT)) throw new ApiError(422, err.invalid)
      const row = messages.find((r) => r.id === Number(params.id))
      if (!row) throw new ApiError(404, err.notFound)
      if ('status' in body) row.status = body.status
      if ('note' in body) row.note = (body.note ?? '').trim() || null
      row.updatedAt = now().toISOString()
      row.updatedBy = user.id
      return readerItem(row)
    },
  }

  // Бейдж пункта меню: число новых сообщений (только читателю)
  const moduleBadges = (user) => {
    const n = isReader(user) ? messages.filter((r) => r.status === 'new').length : 0
    return n > 0 ? { feedback: n } : {}
  }

  return { handlers, moduleBadges, storage: () => messages }
}
