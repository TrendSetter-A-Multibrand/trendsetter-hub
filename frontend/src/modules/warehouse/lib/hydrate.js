// Слияние снимка приёмки из базы с локальным состоянием ПК. Чистые функции: без localStorage и React.
// Результат merge() имеет ту же форму, что и S.st, поэтому выгрузки (csv.js) и маршрутизация (plan.js) не меняются.
import { norm, boxId } from './format.js'

// Строка снимка [id, t, worker, box, boxCode, barcode, status, noCz, ki, full] -> скан в формате браузера.
// В базе barcode = EAN; у скана ЧЗ в браузере bc = КИ, а EAN лежит в ean.
export function fromRow(row) {
  const [id, t, worker, box, boxCode, barcode, status, noCz, ki, full] = row
  if (!ki) return { id, t, worker, box, boxCode, bc: barcode, status, noCz: Boolean(noCz) }
  const s = { id, t, worker, box, boxCode, bc: ki, ki, ean: barcode, gtin: ki.slice(2, 16), status, noCz: Boolean(noCz) }
  if (full) s.full = full
  return s
}

// Ключ раскладки (первый индекс alloc) вычисляется всегда по раскладке, сохранённое s.n не используется
export function nKey(s, plan) {
  if (!s.ki) return norm(s.bc)
  return plan && plan.kiCount > 0 ? s.ki : norm(s.ki.slice(2, 16))
}

const byTime = (a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

function tally(scans, plan) {
  const fact = {}
  const alloc = {}
  for (const s of scans) {
    fact[s.box] = (fact[s.box] || 0) + 1
    if (s.status === 'ok') {
      const n = nKey(s, plan)
      alloc[n] = alloc[n] || {}
      alloc[n][s.box] = (alloc[n][s.box] || 0) + 1
    }
  }
  return { fact, alloc }
}

// db: {receipt, scans (уже fromRow), closed} | null; st: S.st
// opts: {plan, undone: Set id, reopened: Set кодов, queue: S.q}
export function merge(db, st, opts = {}) {
  const { plan = null, undone = new Set(), reopened = new Set(), queue = [] } = opts
  if (!db || String(db.receipt).toLowerCase() !== String(st.receipt || '').toLowerCase()) {
    const scans = st.scans.slice()
    return { receipt: st.receipt, scans, closed: st.closed.slice(), ...tally(scans, plan), closedElsewhere: [] }
  }

  // 2. закрытые короба
  const dbClosed = db.closed.filter((c) => !reopened.has(c.code))
  const known = new Set(dbClosed.map((c) => c.code))
  const closed = [...dbClosed, ...st.closed.filter((c) => !known.has(c.code))].sort((a, b) => b.closedAt - a.closedAt)

  // 3. сканы
  const finalOf = new Map(closed.map((c) => [boxId(c.code), c.code]))
  const local = new Map(st.scans.map((s) => [s.id, s]))
  const withFinal = (s) => {
    const fin = s.boxCode != null ? finalOf.get(boxId(s.boxCode)) : null
    return fin && fin !== s.boxCode ? { ...s, boxCode: fin } : s
  }
  const seen = new Set()
  const scans = []
  for (const row of db.scans) {
    if (undone.has(row.id) || seen.has(row.id)) continue
    seen.add(row.id)
    scans.push(withFinal(local.get(row.id) || row))
  }
  for (const s of st.scans)
    if (!seen.has(s.id)) {
      seen.add(s.id)
      scans.push(withFinal(s))
    }
  scans.sort(byTime)

  // 6. открытые на этом ПК короба, которые на самом деле уже закрыты (на другом ПК)
  const closedIds = new Set(dbClosed.map((c) => boxId(c.code)))
  const doneHere = new Set(st.closed.map((c) => boxId(c.code)))
  for (const o of queue)
    if (o.op === 'close') {
      doneHere.add(boxId(o.boxCode))
      if (o.tmp) doneHere.add(boxId(o.tmp))
    }
  const closedElsewhere = []
  for (const k in st.boxes) {
    const code = st.boxes[k].box && st.boxes[k].box.code
    if (code && closedIds.has(boxId(code)) && !doneHere.has(boxId(code))) closedElsewhere.push(code)
  }

  return { receipt: st.receipt, scans, closed, ...tally(scans, plan), closedElsewhere }
}
