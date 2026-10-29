import { moduleNumber } from './moduleNumber.js'

// Шапка страницы V1: красная моно-метка [ 02 · СКЛАД ], заголовок 64px, подзаголовок; справа — кнопки (children)
export default function PageHead({ module, eyebrow, title, subtitle, children }) {
  const num = module ? moduleNumber(module.id) : null
  const tag = eyebrow ?? (module ? [num, module.strings.dept].filter(Boolean).join(' · ') : null)
  return (
    <section className="page-head">
      <div className="page-head-text">
        {tag && <span className="page-eyebrow">[ {tag} ]</span>}
        <h1 className="h1">{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </section>
  )
}
