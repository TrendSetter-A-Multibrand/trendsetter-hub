import { Tooltip } from 'antd'
import strings from '../../strings.js'
import { donutArcs, pct } from '../../lib/stats.js'

const s = strings.stats
const INK = 'var(--ink)'
const INK_SECOND = 'var(--muted)'
const INK_MUTED = 'var(--faint)'
const TRACK = 'var(--border-soft)'

// Карточка-число. hint — Tooltip на всю карточку
export function Kpi({ title, value, sub, hint }) {
  const body = (
    <div style={{ padding: '10px 14px', border: '1px solid var(--border)', background: 'var(--surface)', borderRadius: 0, height: '100%' }}>
      <div style={{ fontSize: 13, color: INK_SECOND, marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 500, lineHeight: 1.15, color: INK }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: INK_MUTED, marginTop: 2 }}>{sub}</div>}
    </div>
  )
  return hint ? <Tooltip title={hint}>{body}</Tooltip> : body
}

// items: [{ label, value, rest? }] (см. toDonutItems); center — подпись над легендой
export function Donut({ items, center, size = 120 }) {
  const arcs = donutArcs(items, size)
  const sum = items.reduce((a, i) => a + i.value, 0)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <svg width={size} height={size} style={{ flexShrink: 0, transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={arcs[0]?.r ?? 0} fill="none" style={{ stroke: TRACK }} strokeWidth={18} />
        {arcs.map((a) => (
          <Tooltip key={a.label} title={`${a.label}: ${a.value} ${s.unit} · ${pct(a.value, sum)}%`}>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={a.r}
              fill="none"
              stroke={a.color}
              strokeWidth={18}
              strokeDasharray={`${Math.max(a.length - 2, 0)} ${a.circumference}`}
              strokeDashoffset={-a.offset}
            />
          </Tooltip>
        ))}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
        {center && <div style={{ fontSize: 12, color: INK_MUTED, marginBottom: 2 }}>{center}</div>}
        {arcs.map((a) => (
          <div key={a.label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, minWidth: 0 }}>
            <span style={{ width: 10, height: 10, borderRadius: 0, background: a.color, flexShrink: 0 }} />
            <span style={{ color: INK_SECOND, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }} title={a.label}>
              {a.label}
            </span>
            <span style={{ color: INK, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{pct(a.value, sum)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// rows: [{ label, value, color, total }] — полоса и справа «число · процент»
export function BarList({ rows }) {
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 120, flexShrink: 0, fontSize: 13, color: INK_SECOND, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>
            {r.label}
          </div>
          <div style={{ flex: 1, minWidth: 0, height: 16, background: TRACK, borderRadius: 0 }}>
            <div style={{ height: '100%', background: r.color, borderRadius: 0, width: `${Math.max((r.value / max) * 100, r.value > 0 ? 1.5 : 0)}%` }} />
          </div>
          <div style={{ width: 80, flexShrink: 0, fontSize: 13, fontVariantNumeric: 'tabular-nums', textAlign: 'right', color: INK }}>
            {r.value} · {pct(r.value, r.total)}%
          </div>
        </div>
      ))}
    </div>
  )
}
