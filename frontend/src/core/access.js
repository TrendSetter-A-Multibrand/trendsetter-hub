// Чистые функции прав доступа. Без React, sessionStorage и мока.
export const ACCESS_LEVELS = ['admin', 'superuser', 'employee', 'viewer']

export const GROUP_PERMISSIONS = ['view', 'run', 'responsible']
const ACCESS_ORDER = ['none', 'structure', 'view', 'run']

function baseAccess(user, moduleDepartmentIds) {
  if (!user || user.is_active === false) return 'none'
  if (!ACCESS_LEVELS.includes(user.access_level)) return 'none'
  switch (user.access_level) {
    case 'admin':
    case 'superuser':
      return 'run'
    case 'viewer':
      return 'structure'
    default: {
      const own = user.department_ids ?? []
      const shared = (moduleDepartmentIds ?? []).some((id) => own.includes(id))
      return shared ? 'run' : 'none'
    }
  }
}

// Доступ к модулю: 'none' | 'structure' | 'view' | 'run'. Группы только расширяют права (максимум).
// forAll — модуль виден всем активным сотрудникам независимо от отдела (просмотр)
export function computeModuleAccess(user, moduleDepartmentIds, groupPermissions = [], forAll = false) {
  if (!user || user.is_active === false || !ACCESS_LEVELS.includes(user.access_level)) return 'none'
  let base = baseAccess(user, moduleDepartmentIds)
  if (forAll && base === 'none') base = 'view'
  const perms = [...groupPermissions]
  // TODO(Q-G1): группа поднимает и viewer
  const granted =
    perms.includes('run') || perms.includes('responsible') ? 'run' : perms.includes('view') ? 'view' : 'none'
  return ACCESS_ORDER[Math.max(ACCESS_ORDER.indexOf(base), ACCESS_ORDER.indexOf(granted))]
}

// Ответственный по группе (флаг отдельно от module_access: там значения 'responsible' нет)
export function isModuleResponsible(user, groupPermissions = []) {
  if (!user || user.is_active === false) return false
  if (!ACCESS_LEVELS.includes(user.access_level)) return false
  // TODO(Q-G2): admin/superuser автоматически не ответственные
  return [...groupPermissions].includes('responsible')
}

export const canSeeData = (access) => access === 'view' || access === 'run'

export const canRun = (access) => access === 'run'

// Скрыт ли модуль в меню и на /modules/<id>: hidden в реестре — boolean или (me) => boolean
export const isModuleHidden = (module, me) => (typeof module.hidden === 'function' ? Boolean(module.hidden(me)) : Boolean(module.hidden))

// Куда перенаправить со страницы модуля: redirect в реестре — строка или (me) => строка | null. Нет поля или пусто — null.
export const resolveRedirect = (module, me) => (typeof module.redirect === 'function' ? module.redirect(me) : module.redirect) || null

export const canManageUsers = (user) =>
  Boolean(user) && user.is_active !== false && user.access_level === 'admin'
