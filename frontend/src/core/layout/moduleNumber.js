import { MODULES } from '../../modules/registry.js'

// Номер модуля как в меню: 01, 02, … (скрытые модули не считаются)
export const moduleNumber = (id) => {
  const i = MODULES.filter((m) => !m.hidden).findIndex((m) => m.id === id)
  return i < 0 ? null : String(i + 1).padStart(2, '0')
}
