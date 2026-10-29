// Настройка виджетов главной (без React). config — ответ GET /core/home/widgets: [{ id, enabled }] в сохранённом порядке или null.
// Каталог виджетов знает только фронт: неизвестные id из config пропускаются, новые виджеты (не упомянутые в config) идут в конце
// в порядке по умолчанию и включены.

// Все виджеты в порядке настройки с признаком enabled: [{ widget, enabled }]
function resolve(widgets, config) {
  const byId = new Map(widgets.map((w) => [w.id, w]))
  const seen = new Set()
  const ordered = []
  for (const entry of config) {
    const widget = byId.get(entry?.id)
    if (!widget || seen.has(widget.id)) continue
    seen.add(widget.id)
    ordered.push({ widget, enabled: entry.enabled !== false })
  }
  for (const widget of widgets) if (!seen.has(widget.id)) ordered.push({ widget, enabled: true })
  return ordered
}

// Все виджеты в порядке настройки, у каждого enabled (выключенные тоже — для редактора)
export function orderWidgets(widgets, config) {
  return resolve(widgets, config ?? []).map(({ widget, enabled }) => ({ ...widget, enabled }))
}

// Виджеты для показа: в порядке настройки, без выключенных. config == null — как есть
export function applyWidgetConfig(widgets, config) {
  if (config == null) return widgets
  return resolve(widgets, config).filter((r) => r.enabled).map((r) => r.widget)
}
