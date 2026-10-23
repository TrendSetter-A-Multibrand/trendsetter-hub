import strings from '../strings.js'
import logoUrl from '../assets/trendsetter-logo.svg'

const s = strings.header

export default function TeamHeader({ query, onQuery, found, onLeaders, onExpand, view, onView, dirs, total, dirFilter, onDir, onMyProfile }) {
  const chips = [
    { id: null, label: s.all, color: '#A22325', count: total },
    ...dirs.map((d) => ({ id: d.id, label: d.shortName, color: d.color, count: d.count })),
  ]
  return (
    <header className="tm-head">
      <div className="tm-head-row">
        <div className="tm-logo">
          <img className="tm-logo-img" src={logoUrl} alt={strings.logo} />
          <span className="mono tm-logo-sub">{strings.mapLabel}</span>
        </div>
        <div className="tm-search">
          <svg width="16" height="16" viewBox="0 0 256 256" fill="#8A8381" aria-hidden="true">
            <path d="M229.66 218.34l-50.07-50.06a88.11 88.11 0 1 0-11.31 11.31l50.06 50.07a8 8 0 0 0 11.32-11.32ZM40 112a72 72 0 1 1 72 72 72.08 72.08 0 0 1-72-72Z" />
          </svg>
          <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder={s.searchPlaceholder} aria-label={s.searchLabel} />
          {found !== null && (
            <>
              <span className="mono tm-found">{s.found(found)}</span>
              <button type="button" className="tm-clear" onClick={() => onQuery('')} aria-label={s.clear}>
                ×
              </button>
            </>
          )}
        </div>
        <div className="tm-actions">
          <button type="button" className="tm-btn tm-btn-primary" onClick={onLeaders}>
            {s.leadersOnly}
          </button>
          <button type="button" className="tm-btn" onClick={onExpand}>
            {s.expandAll}
          </button>
          {onMyProfile && (
            <button type="button" className="tm-btn tm-btn-primary" onClick={onMyProfile}>
              {s.myProfile}
            </button>
          )}
        </div>
      </div>
      <div className="tm-head-row tm-head-row2">
        <div className="tm-views" role="group" aria-label={s.viewsLabel}>
          {[
            ['cards', s.viewCards],
            ['scheme', s.viewScheme],
          ].map(([id, label]) => (
            <button type="button" key={id} className={view === id ? 'on' : ''} aria-pressed={view === id} onClick={() => onView(id)}>
              {label}
            </button>
          ))}
        </div>
        {chips.map((c) => {
          const on = dirFilter === c.id
          return (
            <button
              type="button"
              key={c.id ?? 'all'}
              className={`tm-chip${on ? ' on' : ''}`}
              aria-pressed={on}
              onClick={() => onDir(on && c.id ? null : c.id)}
            >
              <span className="tm-chip-dot" style={{ background: c.color }} />
              <span>{c.label}</span>
              <span className="mono tm-chip-count">{c.count}</span>
            </button>
          )
        })}
      </div>
    </header>
  )
}
