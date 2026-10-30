// Вкладки страницы «Персонал»: extra (из module.extraTabs реестра) вставляются перед первой вкладкой группы security (Журнал);
// нет такой группы — в конец. Порядок внутри extra сохраняется, base не меняется.
export function mergeTabs(base, extra) {
  if (!extra.length) return base
  const at = base.findIndex((t) => t.group === 'security')
  return at === -1 ? [...base, ...extra] : [...base.slice(0, at), ...extra, ...base.slice(at)]
}
