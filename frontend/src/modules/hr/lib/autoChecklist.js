// Автозапуск чек-листа при создании человека / увольнении (без React; api передаётся параметром, чтобы тестировать с mock-транспортом).
const BASE = '/modules/hr'

// Активные шаблоны вида в порядке списка
export const activeTemplates = (templates, kind) => templates.filter((t) => t.kind === kind && t.active)

// Выбранный шаблон, если он среди активных; иначе первый активный; иначе null
export const pickTemplateId = (list, chosenId) => (list.some((t) => t.id === chosenId) ? chosenId : (list[0]?.id ?? null))

// Есть ли у человека активный чек-лист этого вида
export const hasActiveChecklist = (checklists, kind) => checklists.some((c) => c.kind === kind && c.status === 'active')

// Запуск чек-листа: { status: 'started', checklist } | { status: 'exists' } | { status: 'failed' }.
// skipIfActive — не запускать, если у человека уже есть активный чек-лист этого вида (если проверка не удалась — запускаем).
export async function startAutoChecklist(api, { personId, templateId, kind, skipIfActive = false }) {
  try {
    if (skipIfActive) {
      const existing = await api.get(`${BASE}/people/${personId}/checklists`).catch(() => [])
      if (hasActiveChecklist(existing, kind)) return { status: 'exists' }
    }
    const checklist = await api.post(`${BASE}/people/${personId}/checklists`, { templateId })
    return { status: 'started', checklist }
  } catch {
    return { status: 'failed' }
  }
}
