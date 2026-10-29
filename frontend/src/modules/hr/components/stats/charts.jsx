import { Tooltip } from 'antd'
import strings from '../../strings.js'
import { pct } from '../../lib/stats.js'

const s = strings.stats
// Цвета долей: Sage, Red, жёлтый, синий, зелёный, розовый, «другие» — серый (как в макете V1)
const MIX = ['var(--data-1)', 'var(--data-2)', 'var(--data-3)', 'var(--data-4)', 'var(--data-5)', 'var(--data-6)']
const OTHERS = 'var(--data-7)'

// Ячейка показателя в сетке с общими линиями. hint — подсказка на всю ячейку
export function Kpi({ title, value, sub, hint }) {
  const body = (
    <div className="hr-kpi">
      <span className="hr-kpi-label">{title}</span>
      <span className="hr-kpi-value">{value}</span>
      {sub && <span className="hr-kpi-sub">{sub}</span>}
    </div>
  )
  return hint ? <Tooltip title={hint}>{body}</Tooltip> : body
}

// Доли одной полосой на 100% и легенда; items: [{ label, value, rest? }] (см. toDonutItems)
export function MixBar({ title, meta, items }) {
  const sum = items.reduce((a, i) => a + i.value, 0)
  const colorOf = (i, idx) => (i.rest !== undefined ? OTHERS : MIX[idx % MIX.length])
  const aria = `${title}: ${items.map((i) => `${i.label} ${pct(i.value, sum)}%`).join(', ')}`
  return (
    <div className="hr-mix">
      <div className="hr-mix-head">
        <span className="hr-mix-title">{title}</span>
        <span className="hr-mix-meta">{meta}</span>
      </div>
      {sum === 0 ? (
        <div className="hr-mix-empty">{s.noData}</div>
      ) : (
        <>
          <div className="hr-mix-bar" role="img" aria-label={aria}>
            {items.map((i, idx) => (
              <span key={i.label} style={{ flex: `${i.value} 1 0`, background: colorOf(i, idx) }} title={`${i.label}: ${i.value} ${s.unit}`} />
            ))}
          </div>
          <div className="hr-mix-legend">
            {items.map((i, idx) => (
              <span key={i.label} className="hr-mix-item">
                <span className="hr-sq" style={{ background: colorOf(i, idx) }} aria-hidden="true" />
                {i.label} <span className="hr-mix-pct">{pct(i.value, sum)}%</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// Шапка графика доли: название слева, источник и «N из M» справа
function MixHead({ title, meta }) {
  return (
    <div className="hr-mix-head">
      <span className="hr-mix-title">{title}</span>
      <span className="hr-mix-meta">{meta}</span>
    </div>
  )
}

const ariaOf = (title, items, sum) => `${title}: ${items.map((i) => `${i.label} ${pct(i.value, sum)}%`).join(', ')}`
const colorAt = (i, idx) => (i.rest !== undefined ? OTHERS : MIX[idx % MIX.length])
const tip = (i, sum) => `${i.label}: ${i.value} ${s.unit} · ${pct(i.value, sum)}%`

// Легенда столбиком: квадрат, подпись, процент и число людей
function Legend({ items, sum }) {
  return (
    <div className="hr-legend">
      {items.map((i, idx) => (
        <span key={i.label} className="hr-legend-row">
          <span className="hr-sq" style={{ background: colorAt(i, idx) }} aria-hidden="true" />
          <span className="hr-legend-label">{i.label}</span>
          <span className="hr-mix-pct">{pct(i.value, sum)}%</span>
          <span className="hr-legend-n">{i.value}</span>
        </span>
      ))}
    </div>
  )
}

// Кольцо: сектора с зазором, в центре — доля самой большой группы
export function Donut({ title, meta, items }) {
  const sum = items.reduce((a, i) => a + i.value, 0)
  const R = 52
  const C = 2 * Math.PI * R
  const gap = items.length > 1 ? 3 : 0
  const top = items.reduce((a, i) => (i.value > a.value ? i : a), items[0] ?? { value: 0 })
  // Начало каждого сектора — сумма длин предыдущих
  const segs = items.map((i, idx) => ({ i, idx, len: (i.value / sum) * C, start: (items.slice(0, idx).reduce((a, p) => a + p.value, 0) / sum) * C }))
  return (
    <div className="hr-mix">
      <MixHead title={title} meta={meta} />
      {sum === 0 ? (
        <div className="hr-mix-empty">{s.noData}</div>
      ) : (
        <div className="hr-donut-wrap">
          <div className="hr-donut">
            <svg viewBox="0 0 128 128" role="img" aria-label={ariaOf(title, items, sum)}>
              {segs.map(({ i, idx, len, start }) => (
                  <Tooltip key={i.label} title={tip(i, sum)}>
                    <circle
                      cx="64"
                      cy="64"
                      r={R}
                      fill="none"
                      stroke={colorAt(i, idx)}
                      strokeWidth="18"
                      strokeDasharray={`${Math.max(len - gap, 1)} ${C}`}
                      strokeDashoffset={-start}
                      transform="rotate(-90 64 64)"
                    />
                  </Tooltip>
              ))}
            </svg>
            <span className="hr-donut-center" aria-hidden="true">
              <span className="hr-donut-value">{pct(top.value, sum)}%</span>
              <span className="hr-donut-label">{top.label}</span>
            </span>
          </div>
          <Legend items={items} sum={sum} />
        </div>
      )}
    </div>
  )
}

// Сетка из квадратов: один квадрат — один человек (при >100 — один квадрат на 1%)
export function Waffle({ title, meta, items }) {
  const sum = items.reduce((a, i) => a + i.value, 0)
  const scale = sum > 100 ? 100 / sum : 1
  const cells = items.flatMap((i, idx) => Array.from({ length: Math.round(i.value * scale) }, (_, k) => ({ i, idx, k })))
  return (
    <div className="hr-mix">
      <MixHead title={title} meta={meta} />
      {sum === 0 ? (
        <div className="hr-mix-empty">{s.noData}</div>
      ) : (
        <>
          <div className="hr-waffle" role="img" aria-label={ariaOf(title, items, sum)}>
            {cells.map(({ i, idx, k }) => (
              <Tooltip key={`${i.label}-${k}`} title={tip(i, sum)}>
                <span style={{ background: colorAt(i, idx) }} />
              </Tooltip>
            ))}
          </div>
          <div className="hr-mix-legend">
            {items.map((i, idx) => (
              <span key={i.label} className="hr-mix-item">
                <span className="hr-sq" style={{ background: colorAt(i, idx) }} aria-hidden="true" />
                {i.label} <span className="hr-mix-pct">{pct(i.value, sum)}%</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// Крупные числа: доля каждой группы цифрой и тонкая полоса под ней
export function Split({ title, meta, items }) {
  const sum = items.reduce((a, i) => a + i.value, 0)
  return (
    <div className="hr-mix">
      <MixHead title={title} meta={meta} />
      {sum === 0 ? (
        <div className="hr-mix-empty">{s.noData}</div>
      ) : (
        <div className="hr-split" role="img" aria-label={ariaOf(title, items, sum)}>
          {items.map((i, idx) => (
            <Tooltip key={i.label} title={tip(i, sum)}>
              <div className="hr-split-cell" style={{ flex: `${Math.max(i.value, sum * 0.2)} 1 0` }}>
                <span className="hr-split-value">{pct(i.value, sum)}%</span>
                <span className="hr-split-bar" style={{ background: colorAt(i, idx) }} />
                <span className="hr-split-label">
                  {i.label} · {i.value}
                </span>
              </div>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  )
}

// Столбики по порядковым группам (возраст, стаж): одна серия, пустые группы тоже показываются
export function Columns({ title, meta, items, color = 'var(--data-1)' }) {
  const sum = items.reduce((a, i) => a + i.value, 0)
  const max = Math.max(...items.map((i) => i.value), 1)
  return (
    <div className="hr-mix">
      <MixHead title={title} meta={meta} />
      {sum === 0 ? (
        <div className="hr-mix-empty">{s.noData}</div>
      ) : (
        <div className="hr-cols-chart" role="img" aria-label={ariaOf(title, items, sum)}>
          {items.map((i) => (
            <Tooltip key={i.label} title={tip(i, sum)}>
              <div className="hr-col">
                <span className="hr-col-plot">
                  <span className="hr-col-n">{i.value > 0 ? `${pct(i.value, sum)}%` : ''}</span>
                  <span className="hr-col-bar" style={{ height: `${(i.value / max) * 100}%`, background: color }} />
                </span>
                <span className="hr-col-label">{i.label}</span>
              </div>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  )
}

// rows: [{ label, value, color, total }] — подпись, полоса цвета направления, «число · процент»
export function BarList({ rows }) {
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <div className="hr-bars">
      {rows.map((r) => (
        <div key={r.label} className="hr-bar-row">
          <span className="hr-bar-label" title={r.label}>
            {r.label}
          </span>
          <span className="hr-bar-track" aria-hidden="true">
            <span style={{ width: `${Math.max((r.value / max) * 100, r.value > 0 ? 2 : 0)}%`, background: r.color }} />
          </span>
          <span className="hr-bar-num">
            {r.value} · {pct(r.value, r.total)}%
          </span>
        </div>
      ))}
    </div>
  )
}
