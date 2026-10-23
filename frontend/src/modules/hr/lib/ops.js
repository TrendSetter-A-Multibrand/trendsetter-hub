// Правила истории, оборудования и чек-листов (контракт: docs/TZ-hr-people-ops.md). Общие для UI и mock, без React.
export const HISTORY_KINDS = ['position', 'salary', 'manager', 'direction', 'status', 'other']
export const HISTORY_TITLE_LIMIT = 200
export const HISTORY_TEXT_LIMIT = 500

export const EQUIPMENT_KINDS = ['laptop', 'phone', 'monitor', 'access_card', 'peripheral', 'other']
export const EQUIPMENT_NAME_LIMIT = 120
export const EQUIPMENT_TEXT_LIMIT = 500
export const EQUIPMENT_MAX_COUNT = 100

export const CHECKLIST_KINDS = ['onboarding', 'offboarding']
export const TEMPLATE_TITLE_LIMIT = 120
export const ITEM_TITLE_LIMIT = 200
export const ITEM_NOTE_LIMIT = 500
export const DAYS_OFFSET_MAX = 365

// Не возвращено и срок возврата уже прошёл (сегодня — ещё не просрочено)
export const isEquipmentOverdue = (item, today) => Boolean(item.returnDue) && !item.returnedAt && item.returnDue < today

// Пункт чек-листа просрочен: есть срок, не выполнен, срок до сегодняшнего дня
export const isItemOverdue = (item, today) => Boolean(item.dueDate) && !item.done && item.dueDate < today

// { done, total, percent } по пунктам чек-листа; пустой список — 0%
export function checklistProgress(items) {
  const total = items.length
  const done = items.filter((i) => i.done).length
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) }
}

// Можно ли удалить запись истории (контракт: Resp — любую, Hr — только ручную не salary)
export const canDeleteHistory = (entry, isResponsible) => isResponsible || (!entry.auto && entry.kind !== 'salary')
