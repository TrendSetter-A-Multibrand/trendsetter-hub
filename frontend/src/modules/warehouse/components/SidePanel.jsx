import {
  S, view, ask, boxCount, openKeys, closeBox, closeAll, printOne, printOpen, printTest,
  exportTxt, exportKiz, exportCopy, exportByBox, exportDiff, exportStorage,
} from '../store.js'
import { UNK, byNum } from '../lib/format.js'
import { STATUS } from '../lib/csv.js'
import strings from '../strings.js'
import SectionHead from '../../../core/layout/SectionHead.jsx'
import { useStore } from './useStore.js'

const u = strings.side

function Grid() {
  const { plan, st, hit } = S
  if (!plan) return <div className="wh-empty-plan">{u.emptyPlan}</div>
  const keys = [...plan.boxes]
  if (!keys.includes(UNK)) keys.push(UNK)
  openKeys().forEach((k) => {
    if (!keys.includes(k)) keys.push(k)
  })
  keys.sort(byNum)
  return (
    <div className="wh-grid">
      {keys.map((k) => {
        const c = st.boxes[k] || { box: null, items: [] }
        const n = boxCount(c)
        const tag = c.box && c.box.reopened
          ? u.reopened(c.box.storage ? c.box.storage.code : '')
          : c.box && c.box.from ? u.carried(c.box.from) : ''
        const fact = view().fact[k] || 0
        const exp = plan.expBox[k]
        const isU = k === UNK
        const cnt = plan.hasExp && !isU ? `${fact}/${exp}` : `${fact}`
        const pct = plan.hasExp && exp ? Math.min(100, (fact / exp) * 100) : 0
        const cls = ['wh-cell', n ? '' : 'empty', k === hit ? 'hit' : '', isU ? 'unk' : ''].join(' ')
        return (
          <div key={k} className={cls}>
            <div className="top">
              <div className="num">{k}</div>
              <div className="cnt">
                {cnt}
                <small>{n ? u.inBox(n) : u.empty}</small>
              </div>
            </div>
            {isU ? <div className="tag">{u.unkTag}</div> : plan.hasExp ? <div className="bar"><i style={{ width: pct + '%' }} /></div> : null}
            <div className="code">{c.box ? (c.box.code ? c.box.code : u.gettingNumber) : ''}</div>
            {tag ? <div className="tag2">{tag}</div> : null}
            <div className="acts">
              <button type="button" disabled={!(c.box && c.box.code)} onClick={() => printOne(k)}>{u.label}</button>
              <button
                type="button"
                disabled={!(n && c.box.code && !c.box.closing)}
                onClick={() => ask(u.confirmClose(k, boxCount(st.boxes[k]))).then((ok) => ok && closeBox(k))}
              >
                {c.box && c.box.closing ? u.closing : u.close}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

const EXPORTS = [
  ['txt', exportTxt],
  ['kiz', exportKiz],
  ['copy', exportCopy],
  ['byBox', exportByBox],
  ['diff', exportDiff],
  ['storage', exportStorage],
]

export default function SidePanel() {
  useStore()
  const v = view()
  return (
    <div className="wh-side">
      <section className="section" aria-labelledby="wh-boxes">
        <SectionHead id="wh-boxes" title={u.boxesTitle}>
          <span className="sec-note">{u.openCount(openKeys().length)}</span>
        </SectionHead>
        <Grid />
        <div className="wh-joined">
          <button type="button" className="wh-btn" onClick={printOpen}>{u.printOpen}</button>
          <button type="button" className="wh-btn" onClick={closeAll}>{u.closeAll}</button>
          <button type="button" className="wh-btn" onClick={printTest}>{u.testLabel}</button>
        </div>
      </section>
      <section className="section wh-export" aria-labelledby="wh-export">
        <SectionHead id="wh-export" title={u.exportTitle} />
        <div>
          {EXPORTS.map(([key, fn]) => {
            const [label, ext] = u.exports[key]
            const isCopy = key === 'copy'
            return (
              <div className="wh-export-row" key={key}>
                <span className="wh-export-label">{label}</span>
                <span className="wh-export-ext">{ext}</span>
                <button type="button" className="wh-icon-btn" aria-label={isCopy ? u.copy(label) : u.download(label)} onClick={fn}>
                  {isCopy ? '⧉' : '↓'}
                </button>
              </div>
            )
          })}
        </div>
      </section>
      {v.scans.length > 0 && (
        <section className="section" aria-labelledby="wh-log">
          <SectionHead id="wh-log" title={u.logTitle} />
          <div className="wh-log">
            {v.scans.slice(-60).reverse().map((s, i) => (
              <div key={s.id || i} className={s.status === 'ok' ? '' : 'u'}>
                <span>
                  {s.bc}
                  {s.noCz ? u.noCzSuffix : ''}
                  {s.status === 'ok' ? '' : ' · ' + STATUS[s.status]}
                </span>
                <em>→ {s.box}</em>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
