import Avatar from './Avatar.jsx'
import AwayTag from './AwayTag.jsx'
import strings from '../strings.js'
import { buildRows, cardState, rootsOnPath } from '../lib/tree.js'

const s = strings.hero
const pn = strings.panel

const shortName = (name) => {
  const [last = '', first = ''] = name.split(/\s+/)
  return first ? `${last} ${first.charAt(0)}.` : last
}

const cardClass = (base, cs) => `${base}${cs.mark ? ` is-${cs.mark}` : ''}${cs.dim ? ' is-dim' : ''}`

function Card({ id, cs, onSelect, children, className }) {
  return (
    <div
      className={cardClass(className, cs)}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(id)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onSelect(id)
        }
      }}
    >
      {children}
    </div>
  )
}

function Guide({ g }) {
  return (
    <div className="tm-guide">
      {g.hasTop && <div className={`tm-seg-top${g.topOn ? ' on' : ''}`} />}
      {g.hasBot && <div className={`tm-seg-bot${g.botOn ? ' on' : ''}`} />}
      {g.hasHor && <div className={`tm-seg-hor${g.horOn ? ' on' : ''}`} />}
    </div>
  )
}

export default function DirectionsView({ idx, selectedId, matches, path, collapsed, forceOpen, dirFilter, away, onSelect, onToggle }) {
  const { by, ceoId, assistantIds } = idx
  const ceo = ceoId === null ? null : by[ceoId]
  const state = { selectedId, matches, path }
  const panels = idx.dirs
    .filter((d) => !dirFilter || d.id === dirFilter)
    .filter((d) => !matches || d.ids.some((id) => matches.has(id)))

  return (
    <>
      <div className="tm-hero">
        <h1 className="tm-h1">{strings.heading}</h1>
        {ceo && (
          <div className="tm-hero-row">
            <Card id={ceo.id} cs={cardState(ceo.id, state)} onSelect={onSelect} className="tm-ceo">
              <Avatar person={ceo} size={48} font={16} />
              <div className="tm-ceo-text">
                <span className="tm-ceo-name">{ceo.name}</span>
                <span className="mono tm-ceo-sub">{s.ceoReports(idx.ceoReports)}</span>
                <AwayTag away={away[ceo.id]} />
              </div>
            </Card>
            {assistantIds.map((aid) => (
              <div className="tm-asst-wrap" key={aid}>
                <div className="tm-asst-link">
                  <span className="mono">{s.assistant}</span>
                  <div className="tm-dash" />
                </div>
                <Card id={aid} cs={cardState(aid, state)} onSelect={onSelect} className="tm-asst">
                  <Avatar person={by[aid]} size={32} font={11.5} />
                  <div className="tm-asst-text">
                    <span className="tm-asst-name">{by[aid].name}</span>
                    <span className="tm-asst-title">{by[aid].title}</span>
                    <AwayTag away={away[aid]} />
                  </div>
                </Card>
              </div>
            ))}
          </div>
        )}
        <p className="mono tm-hint">{s.hint}</p>
      </div>

      <div className="tm-panels">
        {panels.map((d) => {
          const rows = buildRows({ by, roots: d.roots, collapsed, forceOpen, path })
          const ghostOn = rootsOnPath(d.roots, path)
          return (
            <section className="tm-panel" key={d.id}>
              <div className="tm-panel-head">
                <span className="tm-bar" style={{ background: d.color }} />
                <span className="mono tm-panel-label">{d.label}</span>
                <span className="mono tm-panel-count">{d.count}</span>
              </div>
              {ceo && (
                <button type="button" className={`mono tm-ghost${ghostOn ? ' on' : ''}`} onClick={() => onSelect(ceo.id)}>
                  {pn.ceoAnchor(shortName(ceo.name))}
                </button>
              )}
              {rows.map((row) => {
                const person = by[row.id]
                return (
                  <div className="tm-row" key={row.id}>
                    {row.guides.map((g, i) => (
                      <Guide g={g} key={i} />
                    ))}
                    <div className="tm-row-body">
                      <Card id={row.id} cs={cardState(row.id, state)} onSelect={onSelect} className="tm-card">
                        <Avatar person={person} size={28} font={10.5} />
                        <div className="tm-card-text">
                          <span className="tm-card-name" style={{ fontWeight: row.depth === 1 ? 600 : 500 }}>
                            {person.name}
                          </span>
                          <span className="tm-card-title">{person.title}</span>
                          {person.tag && <span className="mono tm-tag">{person.tag}</span>}
                          <AwayTag away={away[row.id]} />
                        </div>
                        {row.hasKids && (
                          <button
                            type="button"
                            className="mono tm-toggle"
                            title={row.open ? pn.collapse : pn.expand}
                            aria-label={row.open ? pn.collapse : pn.expand}
                            aria-expanded={row.open}
                            onClick={(e) => {
                              e.stopPropagation()
                              onToggle(row.id)
                            }}
                          >
                            {row.open ? `${person.total} ▾` : `+${person.total} ▸`}
                          </button>
                        )}
                      </Card>
                    </div>
                  </div>
                )
              })}
            </section>
          )
        })}
      </div>
    </>
  )
}
