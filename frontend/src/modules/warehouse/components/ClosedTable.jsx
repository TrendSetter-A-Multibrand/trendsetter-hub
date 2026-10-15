import { S, getPalCache, printClosed } from '../store.js'
import { fmtTime } from '../lib/format.js'
import strings from '../strings.js'
import { useStore } from './useStore.js'

const u = strings.closed

export default function ClosedTable() {
  useStore()
  const { st } = S
  const pc = getPalCache()
  return (
    <section className="wh-closed">
      <h2>{u.title}</h2>
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
            {st.closed.length ? (
              st.closed.map((c, i) => {
                const pal = c.pallet || pc[c.code]
                return (
                  <tr key={c.code}>
                    <td><b>{c.code}</b></td>
                    <td>{c.box}</td>
                    <td>{c.count != null ? c.count : c.items.length}</td>
                    <td>{pal ? <b>{pal}</b> : <span className="wh-bad">{u.noPallet}</span>}</td>
                    <td>{fmtTime(c.opened)}</td>
                    <td>{fmtTime(c.closedAt)}</td>
                    <td><button type="button" onClick={() => printClosed(i)}>{u.print}</button></td>
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
