import { useMemo, useState } from 'react'
import { Alert } from 'antd'
import { formatDate, todayIso } from '../../../core/dates.js'
import Avatar from './Avatar.jsx'
import strings from '../strings.js'
import { buildRows, cardState } from '../lib/tree.js'
import { monthDays, monthEnd, monthStart, segmentsOf, shiftMonth } from '../lib/leave.js'
import { useLeaveRange } from '../lib/useLeave.js'

const s = strings.leave
const pn = strings.panel
const KIND_COLORS = { annual: '#6FA287', unpaid: '#C9A227', study: '#4A7FB5', other: '#8A8381', sick: '#B55A5A' }
const LEGEND_KINDS = ['annual', 'unpaid', 'study', 'other']

const monthTitle = (first) => `${s.months[Number(first.slice(5, 7)) - 1]} ${first.slice(0, 4)}`

// Третий вид карты: таймлайн отпусков по месяцам. Строки — люди по направлениям (дерево, поиск и сворачивание как в «Направлениях»),
// столбцы — дни месяца; отрезки — согласованные отпуска из календаря HR (без больничных).
export default function LeaveView({ idx, selectedId, matches, path, collapsed, forceOpen, dirFilter, onSelect, onToggle }) {
  const today = todayIso()
  const [first, setFirst] = useState(monthStart(today))
  const { data, error } = useLeaveRange(first, monthEnd(first), true)
  const leaves = data ?? []
  const days = useMemo(() => monthDays(first), [first])
  const { by, ceoId, assistantIds } = idx
  const state = { selectedId, matches, path }

  const groups = useMemo(() => {
    const out = []
    const lead = dirFilter ? [] : [ceoId, ...assistantIds].filter((id) => id !== null && (!matches || matches.has(id)))
    if (lead.length > 0) {
      out.push({ key: 'lead', label: s.leadership, color: '#A22325', count: lead.length, rows: lead.map((id) => ({ id, depth: 1, hasKids: false, open: false })) })
    }
    idx.dirs
      .filter((d) => !dirFilter || d.id === dirFilter)
      .filter((d) => !matches || d.ids.some((id) => matches.has(id)))
      .forEach((d) => out.push({ key: d.id, label: d.label, color: d.color, count: d.count, rows: buildRows({ by, roots: d.roots, collapsed, forceOpen, path }) }))
    return out
  }, [idx, by, ceoId, assistantIds, dirFilter, matches, collapsed, forceOpen, path])

  const gridStyle = { '--n': days.length }
  const dayCells = (head) =>
    days.map((d) => (
      <div key={d.iso} className={`tm-tl-cell${d.weekend ? ' we' : ''}${d.iso === today ? ' today' : ''}${head ? ' head' : ''}`} style={{ gridColumn: d.day + 1 }}>
        {head && (
          <>
            <span className="mono tm-tl-wd">{s.weekdays[d.weekday]}</span>
            <span className="tm-tl-dn">{d.day}</span>
          </>
        )}
      </div>
    ))

  return (
    <div className="tm-tl-wrap">
      <div className="tm-tl-bar">
        <button type="button" className="tm-btn" aria-label={s.prev} onClick={() => setFirst(shiftMonth(first, -1))}>
          ‹
        </button>
        <button type="button" className="tm-btn" onClick={() => setFirst(monthStart(today))}>
          {s.today}
        </button>
        <button type="button" className="tm-btn" aria-label={s.next} onClick={() => setFirst(shiftMonth(first, 1))}>
          ›
        </button>
        <h2 className="tm-tl-title">{monthTitle(first)}</h2>
        <div className="tm-tl-legend" aria-label={s.legend}>
          {LEGEND_KINDS.map((k) => (
            <span key={k}>
              <i style={{ background: KIND_COLORS[k] }} />
              {s.kinds[k]}
            </span>
          ))}
        </div>
        {!data && !error && <span className="mono tm-tl-loading">{s.loading}</span>}
      </div>
      {error && <Alert type="error" showIcon title={s.loadError} description={error} style={{ margin: '0 28px 12px' }} />}
      {groups.length === 0 && <p className="tm-tl-empty">{s.empty}</p>}
      <div className="tm-tl-panels">
        {groups.map((g) => (
          <section className="tm-tl" key={g.key} style={gridStyle}>
            <div className="tm-tl-row head">
              <div className="tm-tl-name">
                <span className="tm-bar" style={{ background: g.color }} />
                <span className="mono tm-panel-label">{g.label}</span>
                <span className="mono tm-panel-count">{g.count}</span>
              </div>
              {dayCells(true)}
            </div>
            {g.rows.map((row) => {
              const person = by[row.id]
              const cs = cardState(row.id, state)
              const segs = segmentsOf(leaves, row.id, first)
              return (
                <div
                  key={row.id}
                  className={`tm-tl-row person${cs.mark ? ` is-${cs.mark}` : ''}${cs.dim ? ' is-dim' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(row.id)}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault()
                      onSelect(row.id)
                    }
                  }}
                >
                  <div className="tm-tl-name" style={{ paddingLeft: 8 + (row.depth - 1) * 14 }}>
                    <Avatar person={person} size={22} font={9} />
                    <span className="tm-tl-person">{person.name}</span>
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
                  </div>
                  {dayCells(false)}
                  {segs.map((seg) => (
                    <div
                      key={`${seg.start}-${seg.kind}`}
                      className="tm-tl-seg"
                      style={{ gridColumn: `${seg.col + 1} / span ${seg.span}`, background: KIND_COLORS[seg.kind] ?? KIND_COLORS.other }}
                      title={s.tip(person.name, formatDate(seg.start), formatDate(seg.end), s.kinds[seg.kind] ?? seg.kind)}
                    />
                  ))}
                </div>
              )
            })}
          </section>
        ))}
      </div>
    </div>
  )
}
