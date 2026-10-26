import strings from '../../strings.js'
import { DEMO_MODE } from '../../config.js'
import { ACCESS_LEVELS, GROUP_PERMISSIONS, computeModuleAccess, isModuleResponsible, canSeeData, canRun, canManageUsers } from '../../access.js'
import {
  validateDepartmentName,
  validateGroupName,
  validateDepartmentCode,
  validateUserForm,
  validatePassword,
  validationMessages,
} from '../../admin/validation.js'
import { MODULES, getModule } from '../../../modules/registry.js'
import { ApiError } from '../client.js'
import { data } from './data.js'
import { createAuthHandlers, issueToken, passwordOf, setPassword, userFromToken } from './auth.js'
import { createAuditStore } from './audit.js'
import { createTeamHandlers } from './team.js'
import { createNotificationHandlers } from './notifications.js'
import { createHrHandlers } from './hr.js'
import { createHrOpsHandlers } from './hrOps.js'
import { createPlanHandlers } from './hr-plans.js'
import { createHomeHandlers } from './home.js'

const err = strings.errors

const toPublicUser = (u) => ({ ...u })

function requireManager(token) {
  const user = userFromToken(token)
  if (!canManageUsers(user)) throw new ApiError(403, err.forbidden)
  return user
}

// Права на модуль из групп и личные («особые права»); итог считает computeModuleAccess как максимум
const groupPermissionsOf = (user, moduleId) => [
  ...data.groups.filter((g) => g.user_ids.includes(user.id) && g.permissions[moduleId]).map((g) => g.permissions[moduleId]),
  ...[data.userModulePermissions[user.id]?.[moduleId]].filter(Boolean),
]

const accessTo = (user, moduleId) =>
  computeModuleAccess(user, data.moduleDepartments[moduleId] ?? [], groupPermissionsOf(user, moduleId), Boolean(getModule(moduleId)?.forAll))

function checkGroupPermissions(permissions) {
  for (const [moduleId, permission] of Object.entries(permissions)) {
    if (!MODULES.some((m) => m.id === moduleId)) throw new ApiError(422, err.unknownModule)
    if (!GROUP_PERMISSIONS.includes(permission)) throw new ApiError(422, err.unknownPermission)
  }
}

function checkGroupUserIds(ids) {
  if (!ids.every((id) => data.users.some((u) => u.id === id))) throw new ApiError(422, err.unknownUser)
}

function checkGroupName(name, selfId) {
  const problem = validateGroupName(name, data.groups, selfId)
  if (problem) throw new ApiError(problem === validationMessages.groupNameDuplicate ? 409 : 422, problem)
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isIdList = (v) => Array.isArray(v) && v.every((id) => Number.isInteger(id))

const groupOut = (group) => ({
  ...group,
  permissions: { ...group.permissions },
  user_ids: [...group.user_ids].sort((a, b) => a - b),
  user_count: data.users.filter((u) => u.is_active && group.user_ids.includes(u.id)).length,
})

function requireDemo() {
  if (!DEMO_MODE) throw new ApiError(404, err.notFound)
}

function checkDepartmentIds(ids) {
  if (!Array.isArray(ids) || !ids.every((id) => data.departments.some((d) => d.id === id))) {
    throw new ApiError(422, err.unknownDepartment)
  }
}

function findUser(id) {
  const user = data.users.find((u) => u.id === Number(id))
  if (!user) throw new ApiError(404, err.userNotFound)
  return user
}

const team = createTeamHandlers({ userFromToken, accessTo })
const notifications = createNotificationHandlers({ userFromToken, requireManager, findUser })
const isHrResponsible = (user) => isModuleResponsible(user, groupPermissionsOf(user, 'hr'))
// Журнал HR: читает ответственный за HR или администратор; пишут в него фабрики hr/hrOps и смена пароля
const audit = createAuditStore({ userFromToken, canView: (user) => isHrResponsible(user) || canManageUsers(user), byId: team.byId })
const personIdOfUser = (userId) => team.people().find((p) => p.userId === userId)?.id ?? null
const auth = createAuthHandlers({ userFromToken, audit, personIdOfUser })
const hr = createHrHandlers({
  userFromToken,
  accessTo,
  isResponsible: isHrResponsible,
  team,
  notify: notifications.notify,
  audit,
})
// История, оборудование, чек-листы, экспорт в Excel (часть «А»)
const hrOps = createHrOpsHandlers({ userFromToken, accessTo, isResponsible: isHrResponsible, team, notify: notifications.notify, hr, audit })
// График отпусков, дни рождения, свои документы (часть «Б»): читают хранилище hr и создают заявки его обработчиком
const hrPlans = createPlanHandlers({ userFromToken, accessTo, team, hr })
const home = createHomeHandlers({ userFromToken })

// Бейджи модулей из разных источников суммируются (hr: анкеты на проверку + заявки на отпуск, ждущие HR)
function moduleBadges(user) {
  const badges = { ...team.moduleBadges(user) }
  for (const [id, n] of Object.entries(hr.moduleBadges(user))) badges[id] = (badges[id] ?? 0) + n
  return badges
}

export const handlers = {
  'POST /auth/login': ({ body }) => {
    const email = (body?.email ?? '').trim().toLowerCase()
    const user = data.users.find((u) => u.email.toLowerCase() === email)
    if (!user || !user.is_active || body?.password !== passwordOf(user)) {
      throw new ApiError(401, err.badCredentials)
    }
    return { token: issueToken(user.id) }
  },

  'POST /auth/demo-login': ({ body }) => {
    requireDemo()
    const user = data.users.find((u) => u.id === body?.user_id)
    if (!user || !user.is_active) throw new ApiError(401, err.badCredentials)
    return { token: issueToken(user.id) }
  },

  'GET /auth/demo-users': () => {
    requireDemo()
    return data.users
      .filter((u) => u.is_active)
      .map((u) => ({ id: u.id, full_name: u.full_name, access_level: u.access_level }))
  },

  'POST /auth/logout': () => ({}),

  'GET /core/me': ({ token }) => {
    const user = userFromToken(token)
    return {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      access_level: user.access_level,
      departments: data.departments.filter((d) => user.department_ids.includes(d.id)),
      can_manage_users: canManageUsers(user),
      module_access: Object.fromEntries(MODULES.map((m) => [m.id, accessTo(user, m.id)])),
      module_responsible: Object.fromEntries(
        MODULES.map((m) => [m.id, isModuleResponsible(user, groupPermissionsOf(user, m.id))]),
      ),
      module_badges: moduleBadges(user),
      unread_notifications: notifications.unreadCount(user),
    }
  },

  'GET /core/runs': ({ token, query }) => {
    const user = userFromToken(token)
    const limit = Number(query.limit) || 5
    return data.runs
      .filter((r) => canSeeData(accessTo(user, r.module_id)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
      .map((r) => ({
        id: r.id,
        module_id: r.module_id,
        filename: r.filename,
        user_name: data.users.find((u) => u.id === r.user_id)?.full_name ?? strings.dash,
        status: r.status,
        created_at: r.created_at,
      }))
  },

  'GET /modules/purchasing/files': ({ token }) => {
    const user = userFromToken(token)
    if (!canSeeData(accessTo(user, 'purchasing'))) throw new ApiError(403, err.forbidden)
    return data.purchasingFiles.map(({ user_id, ...f }) => ({
      ...f,
      user_name: data.users.find((u) => u.id === user_id)?.full_name ?? strings.dash,
    }))
  },

  'GET /modules/purchasing/options': ({ token }) => {
    const user = userFromToken(token)
    if (!canSeeData(accessTo(user, 'purchasing'))) throw new ApiError(403, err.forbidden)
    return {
      suppliers: data.purchasingSuppliers,
      presets: data.purchasingPresets,
    }
  },

  'POST /modules/purchasing/inspect': ({ token, body }) => {
    const user = userFromToken(token)
    if (!canRun(accessTo(user, 'purchasing'))) throw new ApiError(403, err.forbidden)
    const result = data.purchasingInspect[body?.filename]
    if (!result) throw new ApiError(422, err.unknownFile)
    return structuredClone(result)
  },

  'POST /modules/purchasing/presets': ({ token, body }) => {
    const user = userFromToken(token)
    if (!canRun(accessTo(user, 'purchasing'))) throw new ApiError(403, err.forbidden)
    const name = (body?.name ?? '').trim()
    if (!name) throw new ApiError(422, err.presetNameEmpty)
    if (data.purchasingPresets.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw new ApiError(409, err.presetNameDuplicate)
    }
    const preset = { id: data.nextId.preset++, name, values: body?.values ?? {} }
    data.purchasingPresets.push(preset)
    return preset
  },

  'GET /admin/users': ({ token }) => {
    requireManager(token)
    return data.users.map(toPublicUser)
  },

  'POST /admin/users': ({ token, body }) => {
    requireManager(token)
    const message = validateUserForm(body ?? {}, data.users)
    if (message) {
      throw new ApiError(message === validationMessages.emailDuplicate ? 409 : 422, message)
    }
    checkDepartmentIds(body.department_ids ?? [])
    const user = {
      id: data.nextId.user++,
      email: body.email.trim(),
      full_name: body.full_name.trim(),
      access_level: body.access_level,
      department_ids: body.department_ids ?? [],
      is_active: true,
    }
    data.users.push(user)
    return toPublicUser(user)
  },

  'PATCH /admin/users/:id': ({ token, params, body }) => {
    const me = requireManager(token)
    const user = findUser(params.id)
    const isSelf = user.id === me.id
    if (body?.access_level !== undefined) {
      if (!ACCESS_LEVELS.includes(body.access_level)) throw new ApiError(422, err.unknownLevel)
      if (isSelf && body.access_level !== user.access_level) throw new ApiError(422, err.selfLevel)
    }
    if (body?.is_active === false && isSelf) throw new ApiError(422, err.selfDisable)
    if (body?.department_ids !== undefined) checkDepartmentIds(body.department_ids)
    if (body?.access_level !== undefined) user.access_level = body.access_level
    if (body?.department_ids !== undefined) user.department_ids = body.department_ids
    if (body?.is_active !== undefined) user.is_active = Boolean(body.is_active)
    return toPublicUser(user)
  },

  'POST /admin/users/:id/password': ({ token, params, body }) => {
    const manager = requireManager(token)
    const user = findUser(params.id)
    const problem = validatePassword(body?.password)
    if (problem) throw new ApiError(422, problem)
    setPassword(user.id, body.password) // закрывает сессии этого пользователя (старые токены mock недействительны)
    audit.log(manager.id, 'core.password_reset', { personId: personIdOfUser(user.id) })
    return {}
  },

  'GET /admin/departments': ({ token }) => {
    requireManager(token)
    return data.departments.map((d) => ({
      ...d,
      user_count: data.users.filter((u) => u.is_active && u.department_ids.includes(d.id)).length,
    }))
  },

  'POST /admin/departments': ({ token, body }) => {
    requireManager(token)
    const nameError = validateDepartmentName(body?.name, data.departments)
    if (nameError) throw new ApiError(nameError === validationMessages.nameDuplicate ? 409 : 422, nameError)
    const codeError = validateDepartmentCode(body?.code, data.departments)
    if (codeError) throw new ApiError(codeError === validationMessages.codeDuplicate ? 409 : 422, codeError)
    const department = { id: data.nextId.department++, code: body.code, name: body.name.trim() }
    data.departments.push(department)
    return { ...department, user_count: 0 }
  },

  'PATCH /admin/departments/:id': ({ token, params, body }) => {
    requireManager(token)
    const department = data.departments.find((d) => d.id === Number(params.id))
    if (!department) throw new ApiError(404, err.departmentNotFound)
    if (body?.code !== undefined) throw new ApiError(422, err.codeImmutable)
    const nameError = validateDepartmentName(body?.name, data.departments, department.id)
    if (nameError) throw new ApiError(nameError === validationMessages.nameDuplicate ? 409 : 422, nameError)
    department.name = body.name.trim()
    return {
      ...department,
      user_count: data.users.filter((u) => u.is_active && u.department_ids.includes(department.id)).length,
    }
  },

  'GET /admin/groups': ({ token }) => {
    requireManager(token)
    return data.groups.map(groupOut)
  },

  'POST /admin/groups': ({ token, body }) => {
    requireManager(token)
    const permissions = body?.permissions ?? {}
    const userIds = body?.user_ids ?? []
    if (typeof body?.name !== 'string' || !isObject(permissions) || !isIdList(userIds)) {
      throw new ApiError(422, err.invalid)
    }
    checkGroupName(body.name)
    checkGroupPermissions(permissions)
    checkGroupUserIds(userIds)
    const group = {
      id: data.nextId.group++,
      name: body.name.trim(),
      permissions: { ...permissions },
      user_ids: [...new Set(userIds)],
    }
    data.groups.push(group)
    return groupOut(group)
  },

  'PATCH /admin/groups/:id': ({ token, params, body }) => {
    requireManager(token)
    const group = data.groups.find((g) => g.id === Number(params.id))
    if (!group) throw new ApiError(404, err.groupNotFound)
    if (
      (body?.name !== undefined && typeof body.name !== 'string') ||
      (body?.permissions !== undefined && !isObject(body.permissions)) ||
      (body?.user_ids !== undefined && !isIdList(body.user_ids))
    ) {
      throw new ApiError(422, err.invalid)
    }
    if (body?.name !== undefined) checkGroupName(body.name, group.id)
    if (body?.permissions !== undefined) checkGroupPermissions(body.permissions)
    if (body?.user_ids !== undefined) checkGroupUserIds(body.user_ids)
    if (body?.name !== undefined) group.name = body.name.trim()
    if (body?.permissions !== undefined) group.permissions = { ...body.permissions }
    if (body?.user_ids !== undefined) group.user_ids = [...new Set(body.user_ids)]
    return groupOut(group)
  },

  ...auth.handlers,
  ...audit.handlers,
  ...team.handlers,
  ...notifications.handlers,
  ...hr.handlers,
  ...hrOps.handlers,
  ...hrPlans.handlers,
  ...home.handlers,
}
