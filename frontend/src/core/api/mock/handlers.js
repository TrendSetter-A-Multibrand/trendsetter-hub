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
import { createHrStatsHandlers } from './hrStats.js'
import { createHomeHandlers } from './home.js'
import { createNewsHandlers } from './news.js'
import { createHolidaysHandlers } from './holidays.js'
import { createWbHandlers } from './wb.js'
import {
  HR_LEVELS,
  MOCK_DOMAIN,
  ONBOARDING_TTL_DAYS,
  SELF_REGISTER_DAILY_LIMIT,
  SHARED_PASSWORD_MIN_LEN,
  registeredToday,
  selfRegister,
  selfRegisterEmailOk,
  sharedPasswordOk,
  sharedPasswordSet,
  withOnboardingGate,
} from './onboarding.js'

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

// Новичок на шаге «анкета» видит анкету: уровня ещё нет, поэтому для team ему отдаётся view (как own_profile_user на сервере)
const teamAccessTo = (user, moduleId) => (moduleId === 'team' && user.onboarding && !user.must_change_password ? 'view' : accessTo(user, moduleId))
const team = createTeamHandlers({ userFromToken, accessTo: teamAccessTo })
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
// Сводка над таблицей «Сотрудники»: считается из тех же хранилищ; создаётся после hrPlans (дописывает демо-даты рождения поверх его)
const hrStats = createHrStatsHandlers({ userFromToken, accessTo, team, hr })
// Виджеты главной настраивают администраторы и ответственные модулей с флагом homeEditor (как бэкенд home_editor)
const home = createHomeHandlers({
  userFromToken,
  canEditWidgets: (u) => canManageUsers(u) || MODULES.some((m) => m.homeEditor && isModuleResponsible(u, groupPermissionsOf(u, m.id))),
})
// Новости: редактор — ответственный за news или администратор (как бэкенд is_editor)
const news = createNewsHandlers({
  userFromToken,
  accessTo,
  isEditor: (u) => isModuleResponsible(u, groupPermissionsOf(u, 'news')) || canManageUsers(u),
  notify: notifications.notify,
  userById: (id) => data.users.find((u) => u.id === Number(id)) ?? null,
  errors: getModule('news').strings.errors,
})
// Производственный календарь: редактор — ответственный за holidays или администратор (как бэкенд is_editor)
const holidays = createHolidaysHandlers({
  userFromToken,
  accessTo,
  isEditor: (u) => isModuleResponsible(u, groupPermissionsOf(u, 'holidays')) || canManageUsers(u),
  errors: getModule('holidays').strings.errors,
})
// WB «Маркировка»: демо-данные сверки, права как у бэкенда (view/run — данные, run — запись документа)
const wb = createWbHandlers({ userFromToken, accessTo })

// Бейджи модулей из разных источников суммируются (hr: анкеты на проверку + заявки на отпуск, ждущие HR)
function moduleBadges(user) {
  const badges = { ...team.moduleBadges(user) }
  for (const [id, n] of Object.entries(hr.moduleBadges(user))) badges[id] = (badges[id] ?? 0) + n
  for (const [id, n] of Object.entries(news.moduleBadges(user))) badges[id] = (badges[id] ?? 0) + n
  return badges
}

const onboardingOut = () => ({
  passwordSet: sharedPasswordSet(),
  domain: MOCK_DOMAIN,
  domains: [MOCK_DOMAIN],
  updatedAt: sharedPasswordSet() ? data.onboarding.updatedAt : null,
  updatedBy: data.users.find((u) => u.id === data.onboarding.updatedBy)?.full_name ?? null,
  ttlDays: ONBOARDING_TTL_DAYS,
  dailyLimit: SELF_REGISTER_DAILY_LIMIT,
  registeredToday: registeredToday(),
})

function findOnboardingUser(id) {
  const user = findUser(id)
  if (!user.onboarding) throw new ApiError(422, err.onboardingNotActive)
  return user
}

// team.js не меняется: онбординг-надстройка над его обработчиками (метка в списке заявок, справочник отделов, доступ при одобрении)
const teamSubmissions = team.handlers['GET /modules/team/hr/submissions']
const teamApprove = team.handlers['POST /modules/team/hr/submissions/:id/approve']
const teamHrUsers = team.handlers['GET /modules/team/hr/users']
const teamOverrides = {
  'GET /modules/team/hr/submissions': async (request) => {
    const list = await teamSubmissions(request)
    return list.map((x) => ({ ...x, userOnboarding: Boolean(data.users.find((u) => u.id === x.userId)?.onboarding) }))
  },

  // D7: онбординг-учётки в списке «привязать к пользователю» не показываются
  'GET /modules/team/hr/users': async (request) => {
    const list = await teamHrUsers(request)
    return list.filter((x) => !data.users.find((u) => u.id === x.id)?.onboarding)
  },

  'GET /modules/team/hr/departments': ({ token }) => {
    if (accessTo(userFromToken(token), 'hr') !== 'run') throw new ApiError(403, err.forbidden)
    return [...data.departments].sort((a, b) => a.id - b.id).map(({ id, name }) => ({ id, name }))
  },

  'POST /modules/team/hr/submissions/:id/approve': async (request) => {
    const list = await teamSubmissions({ token: request.token, query: { status: 'all' } }) // заодно проверка прав HR
    const sub = list.find((x) => x.id === Number(request.params.id))
    const owner = sub?.status === 'pending' ? data.users.find((u) => u.id === sub.userId) : null
    const onboardingOwner = owner?.onboarding ? owner : null
    const b = request.body ?? {}
    if (onboardingOwner) {
      // все проверки доступа — до записей, как на сервере
      if (!b.accessLevel) throw new ApiError(422, err.onboardingLevelRequired)
      if (!HR_LEVELS.includes(b.accessLevel)) throw new ApiError(422, err.unknownLevel)
      checkDepartmentIds(b.departmentIds ?? [])
    }
    const result = await teamApprove(request)
    if (onboardingOwner) {
      onboardingOwner.access_level = b.accessLevel
      onboardingOwner.department_ids = [...new Set(b.departmentIds ?? [])].sort((a, c) => a - c)
      onboardingOwner.onboarding = false
      const fullName = [sub.values.first_name, sub.values.last_name].map((v) => (v ?? '').trim()).filter(Boolean)
      if (fullName.length === 2) onboardingOwner.full_name = fullName.join(' ').slice(0, 120)
    }
    return result
  },
}

const raw = {
  'POST /auth/login': ({ body }) => {
    const email = (body?.email ?? '').trim().toLowerCase()
    const password = body?.password
    const user = data.users.find((u) => u.email.toLowerCase() === email)
    if (user) {
      if (!user.is_active || (password !== passwordOf(user) && !sharedPasswordOk(user, password))) throw new ApiError(401, err.badCredentials)
      return { token: issueToken(user.id) }
    }
    // самосоздание: общий пароль задан и верен, почта проходит правила домена; все отказы — обычный 401
    if (!sharedPasswordSet() || !selfRegisterEmailOk(email) || password !== data.onboarding.password) throw new ApiError(401, err.badCredentials)
    return { token: issueToken(selfRegister({ emailKey: email, audit }).id) }
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
    // Новичок: права не вычисляются, бейджей и уведомлений нет
    const gated = Boolean(user.must_change_password || user.onboarding)
    return {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      access_level: user.access_level,
      departments: data.departments.filter((d) => user.department_ids.includes(d.id)),
      must_change_password: Boolean(user.must_change_password),
      onboarding: Boolean(user.onboarding),
      can_manage_users: !gated && canManageUsers(user),
      module_access: Object.fromEntries(MODULES.map((m) => [m.id, gated ? 'none' : accessTo(user, m.id)])),
      module_responsible: Object.fromEntries(
        MODULES.map((m) => [m.id, !gated && isModuleResponsible(user, groupPermissionsOf(user, m.id))]),
      ),
      module_badges: gated ? {} : moduleBadges(user),
      unread_notifications: gated ? 0 : notifications.unreadCount(user),
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

  'GET /admin/onboarding': ({ token }) => {
    requireManager(token)
    return onboardingOut()
  },

  // пустой пароль = очистить общий пароль (самосоздание и вход общим паролем выключены)
  'POST /admin/onboarding/password': ({ token, body }) => {
    const manager = requireManager(token)
    const password = body?.password
    if (typeof password !== 'string') throw new ApiError(422, err.invalid)
    if (password === '') {
      data.onboarding.password = null
      audit.log(manager.id, 'core.onboarding_password_clear')
    } else {
      const chars = [...password].length
      if (chars < SHARED_PASSWORD_MIN_LEN || chars > 128 || new TextEncoder().encode(password).length > 72) {
        throw new ApiError(422, err.onboardingPasswordInvalid)
      }
      data.onboarding.password = password
      audit.log(manager.id, 'core.onboarding_password_set') // без значения
    }
    data.onboarding.updatedAt = new Date().toISOString()
    data.onboarding.updatedBy = manager.id
    return onboardingOut()
  },

  'POST /admin/users/:id/onboarding/extend': ({ token, params }) => {
    const manager = requireManager(token)
    const user = findUser(params.id)
    if (!(user.onboarding && user.must_change_password)) throw new ApiError(422, err.onboardingExtendNotAllowed)
    user.onboarding_expires_at = new Date(Date.now() + ONBOARDING_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
    audit.log(manager.id, 'user.onboarding_extend')
    return toPublicUser(user)
  },

  'POST /admin/users/:id/onboarding/finish': ({ token, params, body }) => {
    const manager = requireManager(token)
    const user = findOnboardingUser(params.id)
    if (user.must_change_password) throw new ApiError(422, err.onboardingPasswordPending)
    if (!ACCESS_LEVELS.includes(body?.access_level)) throw new ApiError(422, err.unknownLevel)
    checkDepartmentIds(body.department_ids ?? [])
    user.access_level = body.access_level
    user.department_ids = [...new Set(body.department_ids ?? [])].sort((a, b) => a - b)
    user.onboarding = false
    audit.log(manager.id, 'user.onboarding_finish')
    return toPublicUser(user)
  },

  // удаление онбординг-учётки: почта освобождается и снова регистрируется общим паролем (заявки в team.js остаются: расхождение mock)
  'POST /admin/users/:id/onboarding/delete': ({ token, params }) => {
    const manager = requireManager(token)
    const user = findOnboardingUser(params.id)
    if (user.id === manager.id) throw new ApiError(422, err.selfDisable)
    audit.log(manager.id, 'user.onboarding_delete')
    data.users.splice(data.users.indexOf(user), 1)
    data.groups.forEach((g) => {
      g.user_ids = g.user_ids.filter((id) => id !== user.id)
    })
    delete data.passwords[user.id]
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
  ...teamOverrides,
  ...notifications.handlers,
  ...hr.handlers,
  ...hrOps.handlers,
  ...hrPlans.handlers,
  ...hrStats.handlers,
  ...home.handlers,
  ...news.handlers,
  ...holidays.handlers,
  ...wb.handlers,
}

// Шлюз онбординга оборачивает ВСЕ обработчики
export const handlers = withOnboardingGate(raw, userFromToken)
