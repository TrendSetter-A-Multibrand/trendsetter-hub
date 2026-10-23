// Mock ядра: уведомления внутри хаба и личные права на модули. Контракт — docs/TZ-hr-dossier.md, раздел «API / Ядро».
// Данные in-memory (у каждой фабрики своё хранилище), сбрасываются при перезагрузке страницы. Люди вымышленные.
// Личные права лежат в data.userModulePermissions (их читает расчёт доступа в handlers.js).
import strings from '../../strings.js'
import { GROUP_PERMISSIONS } from '../../access.js'
import { MODULES } from '../../../modules/registry.js'
import { ApiError } from '../client.js'
import { data as hub } from './data.js'

const err = strings.errors
const isIdList = (v) => Array.isArray(v) && v.every((id) => Number.isInteger(id))

export function createNotificationHandlers({ userFromToken, requireManager, findUser }) {
  const db = { items: [], nextId: 1 }

  const out = (n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, createdAt: n.createdAt, read: n.readAt !== null })
  const unreadCount = (user) => db.items.filter((n) => n.userId === user.id && n.readAt === null).length

  // Создаёт уведомление каждому из userIds (без повторов); неизвестных/отключённых пользователей пропускает
  function notify(userIds, { kind, title, body, link = null }) {
    for (const id of new Set(userIds)) {
      const user = hub.users.find((u) => u.id === id)
      if (!user || !user.is_active) continue
      db.items.push({ id: db.nextId++, userId: id, kind, title, body, link, createdAt: new Date().toISOString(), readAt: null })
    }
  }

  const handlers = {
    'GET /core/notifications': ({ token, query }) => {
      const user = userFromToken(token)
      const limit = Math.min(Math.max(Number(query.limit) || 30, 1), 100)
      return db.items
        .filter((n) => n.userId === user.id && (query.unread !== '1' || n.readAt === null))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
        .slice(0, limit)
        .map(out)
    },

    'POST /core/notifications/read': ({ token, body }) => {
      const user = userFromToken(token)
      const ids = body?.ids
      if (ids !== null && ids !== undefined && !isIdList(ids)) throw new ApiError(422, err.invalid)
      const at = new Date().toISOString()
      db.items.forEach((n) => {
        if (n.userId === user.id && n.readAt === null && (ids === null || ids === undefined || ids.includes(n.id))) n.readAt = at
      })
      return { ok: true }
    },

    'GET /admin/users/:id/module-permissions': ({ token, params }) => {
      requireManager(token)
      const user = findUser(params.id)
      return { permissions: { ...(hub.userModulePermissions[user.id] ?? {}) } }
    },

    'PATCH /admin/users/:id/module-permissions': ({ token, params, body }) => {
      requireManager(token)
      const user = findUser(params.id)
      if (!MODULES.some((m) => m.id === body?.moduleId)) throw new ApiError(422, err.unknownModule)
      const permission = body?.permission ?? null
      if (permission !== null && !GROUP_PERMISSIONS.includes(permission)) throw new ApiError(422, err.unknownPermission)
      const own = { ...(hub.userModulePermissions[user.id] ?? {}) }
      if (permission === null) delete own[body.moduleId]
      else own[body.moduleId] = permission
      if (Object.keys(own).length === 0) delete hub.userModulePermissions[user.id]
      else hub.userModulePermissions[user.id] = own
      return { permissions: own }
    },
  }

  return { handlers, notify, unreadCount }
}
