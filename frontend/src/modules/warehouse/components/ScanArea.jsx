import { S, view, handleScan, undo, setUi, focusScan } from '../store.js'
import strings from '../strings.js'
import SectionHead from '../../../core/layout/SectionHead.jsx'
import { useStore } from './useStore.js'

const u = strings.scan

// Поле сканера: рамка 2px, иконка штрихкода, подсказка Enter
export function ScanInput() {
  useStore()
  const { cfg } = S
  return (
    <div className="wh-scanbar">
      <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
        <path d="M4 6v12M7 6v12M10 6v12M14 6v12M16 6v12M20 6v12" />
      </svg>
      <input
        ref={(el) => (S.scanEl = el)}
        className="wh-scan"
        autoComplete="off"
        aria-label={cfg.cz ? u.placeholderCz : u.placeholder}
        placeholder={cfg.cz ? u.placeholderCz : u.placeholder}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault()
            const v = e.target.value
            e.target.value = ''
            handleScan(v)
          }
        }}
      />
      <span className="wh-enter" aria-hidden="true">
        ENTER
      </span>
    </div>
  )
}

// Счётчики: колонки через вертикальную линию, справа — отмена последнего скана и редкие действия
export function Counters() {
  useStore()
  const { plan } = S
  const v = view()
  // TODO(Q-S3): «нет в файле» и «излишки» — отдельные плитки (как в Сводке)
  const stats = [
    { v: v.scans.length, l: u.scanned },
    { v: plan ? (plan.hasExp ? plan.total : plan.lines + u.barcodesSuffix) : '—', l: u.expected },
    { v: v.scans.filter((s) => s.status === 'unknown' || s.status === 'foreign').length, l: u.notInFile, bad: true },
    { v: v.scans.filter((s) => s.status === 'extra').length, l: u.extra, bad: true },
    { v: v.closed.length, l: u.boxesClosed },
  ]
  return (
    <section className="section" aria-labelledby="wh-counters">
      <SectionHead id="wh-counters" title={u.countersTitle}>
        <button type="button" className="wh-btn wh-btn-s" onClick={undo}>
          ↶ {u.undo}
        </button>
        <button type="button" className="wh-btn wh-btn-s wh-more" title={u.moreTitle} aria-label={u.moreTitle} onClick={() => setUi({ more: true })}>
          ⋯
        </button>
      </SectionHead>
      <div className="kpis">
        {stats.map((s) => (
          <div key={s.l} className="kpi">
            <span className="kpi-label">{s.l}</span>
            <span className={`kpi-value${s.bad && s.v ? ' wh-bad' : ''}`}>{s.v}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

// Табло: что и куда класть (цвета сигналов привычны операторам — остаются яркими)
export default function Target() {
  useStore()
  const { target, plan } = S
  return (
    <div key={target.n} className={`wh-target ${target.kind}`}>
      {target.kind === 'idle' && !plan ? <span className="wh-step">[ {u.step} ]</span> : null}
      {target.pre ? <div className="pre">{target.pre}</div> : null}
      <div className="big">{target.big}</div>
      <div className="sub">{target.sub}</div>
      {target.btn ? (
        <button
          type="button"
          className="wh-btn"
          onClick={() => {
            target.btn.fn()
            focusScan()
          }}
        >
          {target.btn.text}
        </button>
      ) : null}
    </div>
  )
}
