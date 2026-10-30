import { MODULES } from '../../modules/registry.js'

// Номер модуля как в меню: 01, 02, … Не считаются только модули с hidden === true;
// скрытые по пользователю (hidden — функция) стоят в конце MODULES и номер имеют.
export const moduleNumber = (id) => {
  const i = MODULES.filter((m) => m.hidden !== true).findIndex((m) => m.id === id)
  return i < 0 ? null : String(i + 1).padStart(2, '0')
}
