import strings from '../../strings.js'
import { DEMO_MODE } from '../../config.js'
import { ACCESS_LEVELS, computeModuleAccess, canSeeData, canRun, canManageUsers } from '../../access.js'
import {
  validateDepartmentName,
  validateDepartmentCode,
  validateUserForm,
  validationMessages,
} from '../../admin/validation.js'
import { MODULES } from '../../../modules/registry.js'
import { ApiError } from '../client.js'
import { data, DEMO_PASSWORD } from './data.js'

const err = strings.errors

const toPublicUser = (u) => ({ ...u })

function userFromToken(token) {
  const id = /^mock:(\d+)$/.exec(token ?? '')?.[1]
  const user = id && data.users.find((u) => u.id === Number(id))
  if (!user || !user.is_active) throw new ApiError(401, err.unauthorized)
  return user
}

function requireManager(token) {
  const user = userFromToken(token)
  if (!canManageUsers(user)) throw new ApiError(403, err.forbidden)
  return user
}

const accessTo = (user, moduleId) => computeModuleAccess(user, data.moduleDepartments[moduleId] ?? [])

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

export const handlers = {
  'POST /auth/login': ({ body }) => {
    const email = (body?.email ?? '').trim().toLowerCase()
    const user = data.users.find((u) => u.email.toLowerCase() === email)
    if (!user || !user.is_active || body?.password !== DEMO_PASSWORD) {
      throw new ApiError(401, err.badCredentials)
    }
    return { token: `mock:${user.id}` }
  },

  'POST /auth/demo-login': ({ body }) => {
    requireDemo()
    const user = data.users.find((u) => u.id === body?.user_id)
    if (!user || !user.is_active) throw new ApiError(401, err.badCredentials)
    return { token: `mock:${user.id}` }
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
}
