import { S, view, handleScan, undo, setUi, focusScan } from '../store.js'
import strings from '../strings.js'
import { useStore } from './useStore.js'

const u = strings.scan

export default function ScanArea() {
  useStore()
  const { cfg, plan, target } = S
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
    <div>
      <input
        ref={(el) => (S.scanEl = el)}
        className="wh-scan"
        autoComplete="off"
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
      <div key={target.n} className={`wh-target ${target.kind}`}>
        {target.pre ? <div className="pre">{target.pre}</div> : null}
        <div className="big">{target.big}</div>
        <div className="sub">{target.sub}</div>
        {target.btn ? (
          <button
            type="button"
            onClick={() => {
              target.btn.fn()
              focusScan()
            }}
          >
            {target.btn.text}
          </button>
        ) : null}
      </div>
      <div className="wh-under">
        <div className="wh-stats">
          {stats.map((s) => (
            <div key={s.l} className={s.bad ? 'bad' : ''}>
              <b>{s.v}</b>
              <span>{s.l}</span>
            </div>
          ))}
        </div>
        <button type="button" onClick={undo}>{u.undo}</button>
        <button type="button" className="wh-more" title={u.moreTitle} onClick={() => setUi({ more: true })}>
          ⋯
        </button>
      </div>
    </div>
  )
}
