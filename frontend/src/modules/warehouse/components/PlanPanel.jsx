import { useMemo, useState } from 'react'
import { S, mappingInfo, applyMapping, cancelMapping, exportUpdDiff } from '../store.js'
import { colName, fmtTime } from '../lib/format.js'
import { previewRows } from '../lib/plan.js'
import strings from '../strings.js'
import { useStore } from './useStore.js'

const u = strings.plan

// Выбор столбцов Excel (пока файл не применён)
function Mapping({ sheet, onSheet }) {
  const { g, rows, upd } = useMemo(() => mappingInfo(sheet), [sheet])
  const [h, setH] = useState(g.hdr)
  const [bc, setBc] = useState(g.bc)
  const [bx, setBx] = useState(g.bx)
  const [q, setQ] = useState(g.q)
  const [kc, setKc] = useState(g.ki)
  const [updSheet, setUpdSheet] = useState(upd[0] || '')
  const opts = (allowNone) => [
    ...(allowNone ? [<option key="n" value={-1}>{u.none}</option>] : []),
    ...Array.from({ length: g.width }, (_, i) => (
      <option key={i} value={i}>
        {colName(i)}
        {g.head[i] !== undefined && g.head[i] !== '' ? ': ' + String(g.head[i]).slice(0, 30) : ''}
      </option>
    )),
  ]
  const ex = previewRows(rows, { bc, bx, h, kc })
  const apply = () => {
    const err = applyMapping({ rows, bc, bx, q, h, kc, updSheet })
    if (err) window.alert(err)
  }
  return (
    <>
      <div className="wh-fname">{S.wbName}</div>
      <div className="wh-meta">{u.checkColumns}</div>
      <div className="wh-cols">
        <label>
          {u.sheet}
          <select value={sheet} onChange={(e) => onSheet(e.target.value)}>
            {S.wb.SheetNames.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          {u.headerRow}
          <select value={h} onChange={(e) => setH(+e.target.value)}>
            <option value={-1}>{u.noHeaders}</option>
            {Array.from({ length: Math.min(rows.length, 15) }, (_, i) => (
              <option key={i} value={i}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
        <label>
          {u.barcode}
          <select value={bc} onChange={(e) => setBc(+e.target.value)}>{opts(false)}</select>
        </label>
        <label>
          {u.boxNumber}
          <select value={bx} onChange={(e) => setBx(+e.target.value)}>{opts(false)}</select>
        </label>
        <label>
          {u.quantity}
          <select value={q} onChange={(e) => setQ(+e.target.value)}>{opts(true)}</select>
        </label>
        <label>
          {u.czCode}
          <select value={kc} onChange={(e) => setKc(+e.target.value)}>{opts(true)}</select>
        </label>
        {upd.length > 0 && (
          <label>
            {u.compareSheet}
            <select value={updSheet} onChange={(e) => setUpdSheet(e.target.value)}>
              <option value="">{u.noCompare}</option>
              {upd.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className="wh-dark" onClick={apply}>{u.apply}</button>
        <button type="button" onClick={cancelMapping}>{u.cancel}</button>
      </div>
      <div className="wh-meta">{ex.length ? u.example + ex.join(';  ') : u.emptyBarcodes}</div>
    </>
  )
}

function Summary() {
  const { plan } = S
  const warn = []
  if (plan.skipped) warn.push(u.warnSkipped(plan.skipped))
  if (plan.multi && !plan.hasQty) warn.push(u.warnMulti(plan.multi))
  if (plan.kiDup) warn.push(u.warnKiDup(plan.kiDup))
  if (plan.upd && (plan.upd.onlyFile.length || plan.upd.onlyUpd.length)) warn.push(u.warnUpd(plan.upd))
  if (plan.has20) warn.push(u.warnBox20)
  const updOk = plan.upd && !plan.upd.onlyFile.length && !plan.upd.onlyUpd.length
  return (
    <>
      <div className="wh-fname">{plan.name}</div>
      <div className="wh-meta">
        {u.loadedAt(fmtTime(plan.loadedAt), plan.lines, plan.boxes.length)}
        {plan.hasExp ? u.expected(plan.total) : ''}
        {plan.kiCount ? u.withCz(plan.kiCount, plan.lines - plan.kiCount) : ''}
        {updOk ? u.updMatch(plan.upd.sheet) : ''}.
      </div>
      {warn.map((w) => (
        <div key={w} className="wh-warn">{w}</div>
      ))}
      {plan.upd && (plan.upd.onlyFile.length || plan.upd.onlyUpd.length) ? (
        <div className="wh-row">
          <button type="button" onClick={exportUpdDiff}>{u.downloadUpdDiff}</button>
        </div>
      ) : null}
    </>
  )
}

export default function PlanPanel() {
  useStore()
  const [sheet, setSheet] = useState(null)
  if (S.wb) {
    const cur = sheet && S.wb.SheetNames.includes(sheet) ? sheet : S.wb.SheetNames[0]
    return (
      <div className="wh-box wh-plan">
        <Mapping key={S.wbName + cur} sheet={cur} onSheet={setSheet} />
      </div>
    )
  }
  if (!S.plan) return null
  return (
    <div className="wh-box wh-plan">
      <Summary />
    </div>
  )
}
