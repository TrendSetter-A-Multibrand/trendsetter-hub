// Раскладка поставки: определение столбцов Excel, построение плана, маршрутизация сканов по коробкам.
// Перенесено из Index.html (guess, applyMapping, route, markedMap, routeMarked) без изменений логики.
import { UNK, byNum, cellStr, boxKey, norm } from './format.js'
import { isDM, kiOf, gtinEan } from './marks.js'

const RX_BC = /(шк|ш\/к|штрих|barcode|bar code|ean|баркод|gtin)/i
const RX_BOX = /(короб|box|ячейк|палл|место|тара)/i
const RX_QTY = /(кол|qty|шт\b|количеств|quantity)/i

// Угадывает строку заголовков и столбцы: штрихкод, коробка, количество, код ЧЗ
export function guess(rows) {
  let hdr = -1
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    if (rows[r].some((c) => RX_BC.test(String(c)) || RX_BOX.test(String(c)))) {
      hdr = r
      break
    }
  }
  const head = hdr >= 0 ? rows[hdr] : []
  const width = Math.max(0, ...rows.slice(0, 200).map((r) => r.length))
  const data = rows.slice(hdr + 1, hdr + 201)
  const find = (rx) => head.findIndex((c) => rx.test(String(c)))
  let bc = find(RX_BC)
  let bx = find(RX_BOX)
  let q = find(RX_QTY)
  if (bc < 0) {
    let best = -1
    let sc = 0
    for (let c = 0; c < width; c++) {
      const n = data.filter((r) => /^\d{8,14}$/.test(cellStr(r[c]))).length
      if (n > sc) {
        sc = n
        best = c
      }
    }
    bc = best
  }
  if (bx < 0) {
    let best = -1
    let sc = 0
    for (let c = 0; c < width; c++) {
      if (c === bc) continue
      const n = data.filter((r) => /^\d{1,3}$/.test(cellStr(r[c]))).length
      if (n > sc) {
        sc = n
        best = c
      }
    }
    bx = best
  }
  if (q === bc || q === bx) q = -1
  let ki = -1
  let ks = 0
  for (let c = 0; c < width; c++) {
    const n = data.filter((r) => isDM(cellStr(r[c]))).length
    if (n > ks && n >= Math.max(1, data.length * 0.3)) {
      ks = n
      ki = c
    }
  }
  if (ki === bc) bc = find(/(ean|штрих)/i) >= 0 && find(/(ean|штрих)/i) !== ki ? find(/(ean|штрих)/i) : bc
  return { hdr, bc, bx, q, ki, width, head }
}

// Другие листы, где почти одни коды ЧЗ (например, «киз из упд»)
export function updCandidates(sheetNames, sheet, rowsOf) {
  return sheetNames
    .filter((n) => n !== sheet)
    .filter((n) => {
      const r = rowsOf(n).flat().map(cellStr).filter(Boolean).slice(0, 60)
      return r.length && r.filter(isDM).length >= r.length * 0.8
    })
}

// Пример строк для предпросмотра выбранных столбцов
export function previewRows(rows, { bc, bx, h, kc }) {
  return rows
    .slice(h + 1)
    .filter((r) => cellStr(r[bc]) || kiOf(r[kc]))
    .slice(0, 2)
    .map((r) => `${kc >= 0 && kiOf(r[kc]) ? 'КИ ' + kiOf(r[kc]) : cellStr(r[bc])} → коробка ${boxKey(r[bx]) || '?'}`)
}

// Строит раскладку из строк Excel. Возвращает { plan } или { error: 'sameCols' | 'noLines' }.
export function buildPlan({ rows, bc, bx, q, h, kc, updSheet, updRows, name }) {
  if (bc === bx) return { error: 'sameCols' }
  const map = {}
  const boxes = new Set()
  const expBox = {}
  const kiMap = {}
  const kiEan = {}
  const gtinMarked = {}
  let skipped = 0
  let lines = 0
  let total = 0
  let kiCount = 0
  let kiDup = 0
  for (const r of rows.slice(h + 1)) {
    const b = cellStr(r[bc])
    const k = boxKey(r[bx])
    const ki = kc >= 0 ? kiOf(r[kc]) : null
    if (ki && k) {
      // строка с кодом ЧЗ: коробка по точному коду
      if (kiMap[ki]) {
        kiDup++
        continue
      }
      kiMap[ki] = k
      kiEan[ki] = b || gtinEan(ki.slice(2, 16))
      kiCount++
      lines++
      gtinMarked[norm(ki.slice(2, 16))] = k
      boxes.add(k)
      expBox[k] = (expBox[k] || 0) + 1
      total += 1
      continue
    }
    if (!b && !k) continue
    if (!b || !k) {
      skipped++
      continue
    }
    let qty = 1
    if (q >= 0) {
      qty = parseFloat(String(r[q]).replace(',', '.'))
      if (!(qty > 0)) {
        skipped++
        continue
      }
    }
    const n = norm(b)
    lines++
    map[n] = map[n] || []
    const ex = map[n].find((e) => e.box === k)
    if (ex) ex.qty += qty
    else map[n].push({ box: k, qty, raw: b })
    boxes.add(k)
    expBox[k] = (expBox[k] || 0) + qty
    total += qty
  }
  if (!lines) return { error: 'noLines' }
  const multi = Object.values(map).filter((v) => v.length > 1).length
  let upd = null
  if (updSheet && updRows && kiCount) {
    const set = new Set(updRows.flat().map(kiOf).filter(Boolean))
    upd = {
      sheet: updSheet,
      total: set.size,
      onlyFile: Object.keys(kiMap).filter((x) => !set.has(x)),
      onlyUpd: [...set].filter((x) => !kiMap[x]),
    }
  }
  const plan = {
    name,
    loadedAt: Date.now(),
    map,
    kiMap,
    kiEan,
    gtinMarked,
    kiCount,
    kiDup,
    upd,
    boxes: [...boxes].sort(byNum),
    expBox,
    hasQty: q >= 0,
    hasExp: q >= 0 || kiCount > 0,
    total,
    lines,
    skipped,
    multi,
    has20: boxes.has(UNK),
    version: 0,
    receipt: '',
    by: '',
    when: '',
  }
  return { plan }
}

// Куда класть товар с обычным штрихкодом
export function route(plan, alloc, n) {
  const e = plan.map[n]
  if (!e) return { box: UNK, status: 'unknown' }
  if (!plan.hasQty) return { box: e[0].box, status: 'ok' }
  const a = alloc[n] || {}
  for (const x of e) if ((a[x.box] || 0) < x.qty) return { box: x.box, status: 'ok' }
  return { box: UNK, status: 'extra' }
}

// Баркод вещи с кодом ЧЗ: из шаблона (столбец штрихкода той же строки), иначе из GTIN
export const eanOf = (plan, ki, gtin) => (plan && plan.kiEan && plan.kiEan[ki]) || gtinEan(gtin)

// Маркированный товар по EAN (режим «Скан без ЧЗ»): сколько штук и в какую коробку ждём по шаблону
export function markedMap(plan) {
  if (!plan) return {}
  if (plan.markedMap) return plan.markedMap
  const mm = {}
  for (const ki in plan.kiMap || {}) {
    const box = plan.kiMap[ki]
    const keys = new Set([norm(ki.slice(2, 16)), norm(eanOf(plan, ki, ki.slice(2, 16)))])
    keys.forEach((n) => {
      mm[n] = mm[n] || []
      const e = mm[n].find((x) => x.box === box)
      if (e) e.qty++
      else mm[n].push({ box, qty: 1 })
    })
  }
  return (plan.markedMap = mm)
}

export function routeMarked(plan, alloc, n) {
  const e = markedMap(plan)[n]
  const a = alloc[n] || {}
  for (const x of e) if ((a[x.box] || 0) < x.qty) return { box: x.box, status: 'ok' }
  return { box: UNK, status: 'extra' }
}
