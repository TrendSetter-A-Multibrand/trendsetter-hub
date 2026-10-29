import { view, getPalCache, printClosed } from '../store.js'
import { fmtTime } from '../lib/format.js'
import strings from '../strings.js'
import SectionHead from '../../../core/layout/SectionHead.jsx'
import { useStore } from './useStore.js'

const u = strings.closed

export default function ClosedTable() {
  useStore()
  const closed = view().closed
  const pc = getPalCache()
  return (
    <section className="section wh-closed" aria-labelledby="wh-closed">
      <SectionHead id="wh-closed" title={u.title} />
      <div className="wh-tbl">
        <table>
          <thead>
            <tr>
              {u.columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {closed.length ? (
              closed.map((c, i) => {
                const pal = c.pallet || pc[c.code]
                return (
                  <tr key={c.code}>
                    <td><b>{c.code}</b></td>
                    <td>{c.box}</td>
                    <td>{c.count != null ? c.count : c.items.length}</td>
                    <td>{pal ? <b>{pal}</b> : <span className="wh-bad">{u.noPallet}</span>}</td>
                    <td>{c.opened ? fmtTime(c.opened) : ''}</td>
                    <td>{fmtTime(c.closedAt)}</td>
                    <td><button type="button" className="wh-btn wh-btn-s" onClick={() => printClosed(i)}>{u.print}</button></td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan={7} className="wh-muted">{u.none}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
