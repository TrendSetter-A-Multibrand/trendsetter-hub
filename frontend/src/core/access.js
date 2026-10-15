// Чистые функции прав доступа. Без React, sessionStorage и мока.
export const ACCESS_LEVELS = ['admin', 'superuser', 'employee', 'viewer']

// Доступ к модулю: 'none' | 'structure' | 'view' | 'run'
export function computeModuleAccess(user, moduleDepartmentIds) {
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
      return shared ? 'run' : 'view'
    }
  }
}

export const canSeeData = (access) => access === 'view' || access === 'run'

export const canRun = (access) => access === 'run'

export const canManageUsers = (user) =>
  Boolean(user) && user.is_active !== false && user.access_level === 'admin'
