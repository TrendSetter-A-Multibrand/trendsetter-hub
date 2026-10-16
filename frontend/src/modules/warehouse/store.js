// Состояние и логика приёмки. Перенесено из Index.html «Склад-приёмка» почти построчно:
// состояние живёт вне React (как в исходнике), React только перерисовывается по emit().
import strings from './strings.js'
import { UNK, pad, norm, byNum, boxId, BOX_RE, STOR_RE } from './lib/format.js'
import { fixLayout, isDM, parseDM, gtinEan } from './lib/marks.js'
import { guess, updCandidates, buildPlan, route, routeMarked, markedMap, eanOf } from './lib/plan.js'
import { STATUS, allLines, kizLines, byBoxCsv, diffCsv, updDiffCsv, download, stamp, toCsv, parseCsv, parseRuTime } from './lib/csv.js'
import { labelHTML, storLabelHTML, printHTML } from './lib/print.js'
import { backend } from './lib/localBackend.js'

const M = strings.msg
const P = strings.print

/* ---------- Хранение в браузере ---------- */
const CFG_KEY = 'whf_cfg'
const ST_KEY = 'whf_state'
const PLAN_KEY = 'whf_plan'
const Q_KEY = 'whf_queue'
const BREG_KEY = 'whf_boxreg'
const load = (k, d) => {
  try {
    const v = localStorage.getItem(k)
    return v ? JSON.parse(v) : d
  } catch {
    return d
  }
}
const save = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
    return true
  } catch {
    return false
  }
}

const fresh = (receipt) => ({ boxes: {}, scans: [], closed: [], alloc: {}, fact: {}, pend: {}, receipt: receipt || '' })

export const S = {
  cfg: Object.assign({ worker: '', palLabel: false, seq: 0, autoprint: true, dupGuard: true, cz: false, noCz: false }, load(CFG_KEY, {})),
  plan: load(PLAN_KEY, null),
  st: Object.assign(fresh(), load(ST_KEY, {})),
  hit: null,
  // разбор Excel (пока выбираются столбцы)
  wb: null,
  wbName: '',
  receipts: [],
  receiptsMsg: '',
  target: { kind: 'idle', big: M.loadExcel, sub: M.loadExcelSub, pre: '', btn: null, n: 0 },
  // диалоги
  ui: { ask: null, choose: null, receipts: false, receiptPrefill: '', more: false, sectors: false, sectorsRetry: null },
  // синхронизация (локальный бэкенд отвечает сразу)
  q: load(Q_KEY, []),
  inflight: false,
  lastErr: null,
  // элементы для фокуса
  scanEl: null,
  workerEl: null,
}
S.st.pend = S.st.pend || {}

let markReg = new Set(load('whf_marks', []))
let boxReg = load(BREG_KEY, {})
let palCache = {}
const lastAt = {}
let zchain = Promise.resolve()
let codeReq = 0
let XLSX = null

/* ---------- Подписка React ---------- */
const subs = new Set()
let version = 0
export const subscribe = (fn) => {
  subs.add(fn)
  return () => subs.delete(fn)
}
export const getVersion = () => version
export function emit() {
  version++
  subs.forEach((f) => f())
}
const persist = () => {
  save(ST_KEY, S.st)
  save(CFG_KEY, S.cfg)
}

/* ---------- API (единственный шов: позже здесь будут запросы к серверу) ---------- */
export function api(name, ...args) {
  try {
    return Promise.resolve(backend[name](...args))
  } catch (e) {
    return Promise.reject(e)
  }
}

/* ---------- Табло цели ---------- */
export function showTarget(kind, big, sub, pre, btn) {
  S.target = { kind, big, sub: sub || '', pre: pre || '', btn: btn || null, n: S.target.n + 1 }
  emit()
}

/* ---------- Фокус сканера ---------- */
const anyDialog = () => Boolean(S.ui.ask || S.ui.choose || S.ui.receipts || S.ui.more || S.ui.sectors)
export function focusScan() {
  if (anyDialog() || S.wb) return
  if (S.scanEl) S.scanEl.focus()
}

/* ---------- Диалоги ---------- */
export function ask(text) {
  return new Promise((res) => {
    S.ui.ask = { text, done: (v) => {
      S.ui.ask = null
      emit()
      res(v)
      setTimeout(focusScan, 0)
    } }
    emit()
  })
}
export function choose(text, buttons) {
  return new Promise((res) => {
    S.ui.choose = { text, buttons, done: (v) => {
      S.ui.choose = null
      emit()
      res(v)
      setTimeout(focusScan, 0)
    } }
    emit()
  })
}
export function setUi(patch) {
  Object.assign(S.ui, patch)
  emit()
  if (!anyDialog()) setTimeout(focusScan, 0)
}

/* ---------- Звук ---------- */
let actx = null
export function beep(ok) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)()
    const tones = ok ? [[1200, 0.08]] : [[300, 0.18], [0, 0.08], [300, 0.18], [0, 0.08], [300, 0.3]]
    let t = actx.currentTime
    for (const [f, d] of tones) {
      if (f) {
        const o = actx.createOscillator()
        const g = actx.createGain()
        o.type = ok ? 'sine' : 'square'
        o.frequency.value = f
        g.gain.value = 0.15
        o.connect(g)
        g.connect(actx.destination)
        o.start(t)
        o.stop(t + d)
      }
      t += d
    }
  } catch {
    // звук необязателен
  }
}

/* ---------- Очередь отправки ---------- */
const uid = () => 'W-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
export function enqueue(op) {
  op.id = op.id || uid()
  op.pc = S.cfg.worker || ''
  S.q.push(op)
  save(Q_KEY, S.q)
  emit()
  flush()
}
export function flush() {
  if (S.inflight || !S.q.length) return
  S.inflight = true
  const n = Math.min(S.q.length, 300)
  const batch = S.q.slice(0, n)
  api('sync', batch, S.cfg.worker || '')
    .then(() => {
      S.q.splice(0, n)
      save(Q_KEY, S.q)
      S.inflight = false
      S.lastErr = null
      emit()
      if (S.q.length) setTimeout(flush, 200)
    })
    .catch((err) => {
      S.inflight = false
      S.lastErr = (err && err.message) || M.error
      emit()
    })
}

/* ---------- Короба ---------- */
export const boxCount = (c) => ((c.box && c.box.base) || 0) + c.items.length
export const openKeys = () => Object.keys(S.st.boxes).sort(byNum).filter((k) => S.st.boxes[k].box && boxCount(S.st.boxes[k]))
const boxOf = (k) => (S.st.boxes[k] = S.st.boxes[k] || { box: null, items: [] })

// Запросить номер для нового короба. Пока номер едет, сканы копятся и уходят в таблицу вместе с ним.
export function requestBoxCode(k) {
  const cell = S.st.boxes[k]
  if (!cell || !cell.box || cell.box.code) return
  const req = (cell.box.req = ++codeReq)
  api('nextBoxCode', k)
    .then((code) => {
      const c = S.st.boxes[k]
      if (!c || !c.box || c.box.req !== req) return // короб успели отменить
      c.box.code = code
      delete c.box.req
      S.st.scans.forEach((s) => {
        if (s.box === k && !s.boxCode) s.boxCode = code
      })
      ;(S.st.pend[k] || []).forEach((op) => {
        op.boxCode = code
        enqueue(op)
      })
      delete S.st.pend[k]
      persist()
      emit()
    })
    .catch((e) => {
      showTarget('err msg', M.noBoxCode, M.noBoxCodeSub(k, e.message))
      beep(false)
      setTimeout(() => {
        const c = S.st.boxes[k]
        if (c && c.box && c.box.req === req) requestBoxCode(k)
      }, 3000)
    })
}

/* ---------- Раскладка ---------- */
export function setCfg(patch) {
  Object.assign(S.cfg, patch)
  persist()
  emit()
}

async function readXlsx() {
  if (!XLSX) XLSX = await import('xlsx')
  return XLSX
}
export const sheetRows = (name) => {
  if (S.wb.rows) return S.wb.rows[name]
  return XLSX.utils.sheet_to_json(S.wb.Sheets[name], { header: 1, raw: true, defval: '' })
}
export const mappingInfo = (sheet) => {
  const rows = sheetRows(sheet)
  return { rows, g: guess(rows), upd: updCandidates(S.wb.SheetNames, sheet, sheetRows) }
}

export async function loadFile(file) {
  if (!file) return
  try {
    const X = await readXlsx()
    // CSV читаем как текст (UTF-8), иначе кириллица в файле портится
    if (/\.csv$/i.test(file.name)) S.wb = X.read(await file.text(), { type: 'string' })
    else S.wb = X.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' })
    S.wbName = file.name
    emit()
  } catch {
    S.wb = null
    window.alert(M.fileUnreadable)
    emit()
  }
}
export function cancelMapping() {
  S.wb = null
  emit()
  focusScan()
}

export function carryOver(from) {
  const boxes = {}
  const pend = {}
  openKeys().forEach((k) => {
    boxes[k] = S.st.boxes[k]
    if (from && !boxes[k].box.from) boxes[k].box.from = from
    if (S.st.pend[k]) pend[k] = S.st.pend[k]
  })
  return { boxes, pend }
}

// Возвращает текст ошибки или null
export function applyMapping({ rows, bc, bx, q, h, kc, updSheet }) {
  const updRows = updSheet ? sheetRows(updSheet) : null
  const r = buildPlan({ rows, bc, bx, q, h, kc, updSheet, updRows, name: S.wbName })
  if (r.error === 'sameCols') return M.sameCols
  if (r.error === 'noLines') return M.noLines
  S.plan = r.plan
  if (!save(PLAN_KEY, S.plan)) window.alert(M.planTooBig)
  const keep = carryOver(null)
  S.st = fresh(S.st.receipt)
  S.st.boxes = keep.boxes
  S.st.pend = keep.pend
  persist()
  S.wb = null
  S.hit = null
  emit()
  showTarget('idle', M.canScan, M.loadedLines(S.plan.lines))
  openReceipts(/^Google/.test(S.wbName) ? '' : S.wbName.replace(/\.[^.]+$/, ''))
  return null
}

export async function startLoad(openPicker) {
  if (S.st.scans.length && !(await ask(M.confirmNewPlan))) return
  openPicker()
}

/* ---------- Сканирование ---------- */
const DUP_MS = 2000

export function handleScan(raw, force) {
  const bc = raw.trim()
  if (!bc) return
  const { cfg, plan, st } = S
  if (!plan) {
    showTarget('err msg', M.noFile, M.noFileSub)
    beep(false)
    return
  }
  if (!st.receipt) {
    showTarget('err msg', M.noReceipt, M.noReceiptSub)
    beep(false)
    openReceipts()
    return
  }
  if (!cfg.worker) {
    showTarget('err msg', M.whoScans, M.whoScansSub)
    beep(false)
    if (S.workerEl) S.workerEl.focus()
    return
  }
  if (STOR_RE.test(bc)) {
    showTarget('err msg', M.isPalletLabel, M.isPalletLabelSub)
    beep(false)
    return
  }
  if (BOX_RE.test(fixLayout(bc))) {
    const bb = boxId(fixLayout(bc))
    const k = Object.keys(st.boxes).find((x) => st.boxes[x].box && st.boxes[x].box.code && boxId(st.boxes[x].box.code) === bb)
    showTarget('err msg', k ? M.boxWord(k) : M.boxBarcode, k ? M.isBoxBarcode : M.isBoxBarcodeScanGoods)
    beep(false)
    return
  }
  const dm = isDM(fixLayout(bc))
  if (cfg.cz) {
    if (!dm) {
      showTarget('err msg', M.notCz, M.notCzSub(bc))
      beep(false)
      return
    }
    zchain = zchain.then(() => czScan(bc)).catch((e) => {
      showTarget('err msg', M.checkError, e.message)
      beep(false)
    })
    return
  }
  if (dm) {
    showTarget('err msg', M.isCz, cfg.noCz ? M.isCzNoCzOn : M.isCzTurnOn)
    beep(false)
    return
  }
  const n0 = norm(bc)
  const now = Date.now()
  const marked = !plan.map[n0] && !!markedMap(plan)[n0]
  if (marked && !cfg.noCz) {
    showTarget('err msg', M.markedGoods, M.markedGoodsSub(bc))
    beep(false)
    return
  }
  if ((cfg.dupGuard || cfg.noCz) && !force && lastAt[n0] && now - lastAt[n0] < DUP_MS) {
    showTarget('warn', M.repeat, M.repeatSub(bc), M.doubleScan, { text: M.countSecond, fn: () => handleScan(bc, true) })
    beep(false)
    return
  }
  lastAt[n0] = now
  if (marked) recordScan(bc, n0, routeMarked(plan, st.alloc, n0), { noCz: true })
  else recordScan(bc, n0, route(plan, st.alloc, n0), {})
}

async function czScan(raw) {
  const { plan, st, cfg } = S
  const p = parseDM(raw)
  if (!p) {
    showTarget('err msg', M.codeUnknown, M.codeUnknownSub(raw))
    beep(false)
    return
  }
  if (markReg.has(p.ki) || st.scans.some((s) => s.ki === p.ki)) {
    showTarget('err', M.dup, M.dupHere(p.ki), M.czAccepted)
    beep(false)
    return
  }
  const byKi = plan.kiCount > 0
  const n = byKi ? p.ki : norm(p.gtin)
  const r = byKi
    ? plan.kiMap[p.ki]
      ? { box: plan.kiMap[p.ki], status: 'ok' }
      : { box: UNK, status: plan.gtinMarked[norm(p.gtin)] ? 'foreign' : 'unknown' }
    : route(plan, st.alloc, n)
  showTarget('idle', M.checking, p.ki)
  const ean = eanOf(plan, p.ki, p.gtin)
  const res = await api('registerMark', { ki: p.ki, gtin: p.gtin, ean, full: p.full, receipt: st.receipt, box: r.box, pc: cfg.worker || '' })
  if (res.status === 'dup') {
    showTarget('err', M.dup, M.dupThere(p.ki, res), M.czAccepted)
    beep(false)
    return
  }
  markReg.add(p.ki)
  save('whf_marks', [...markReg])
  recordScan(p.ki, n, r, { gtin: p.gtin, ean, ki: p.ki, full: p.full })
}

function recordScan(bc, n, r, extra) {
  const { plan, st, cfg } = S
  const cell = boxOf(r.box)
  let isNew = false
  if (!cell.box) {
    cell.box = { code: null, opened: Date.now() }
    isNew = true
  }
  const t = Date.now()
  cell.items.push({ bc, t, status: r.status })
  const id = uid()
  st.scans.push(Object.assign({ id, bc, n, box: r.box, boxCode: cell.box.code, t, status: r.status, worker: cfg.worker }, extra))
  const op = Object.assign(
    { op: 'scan', id, t, box: r.box, boxCode: cell.box.code, bc: extra.ean || bc, status: STATUS[r.status] + (extra.noCz ? ', без ЧЗ' : ''), receipt: st.receipt },
    extra.ki ? { ki: extra.ki, full: extra.full } : {},
  )
  if (cell.box.code) enqueue(op)
  else (st.pend[r.box] = st.pend[r.box] || []).push(op)
  if (isNew) requestBoxCode(r.box)
  st.fact[r.box] = (st.fact[r.box] || 0) + 1
  if (r.status === 'ok') {
    st.alloc[n] = st.alloc[n] || {}
    st.alloc[n][r.box] = (st.alloc[n][r.box] || 0) + 1
  }
  S.hit = r.box
  const shown = extra.gtin ? `${extra.ean}\nЧЗ ${extra.ki.slice(18)}` : bc
  if (r.status === 'ok') {
    let sub = shown
    if (extra.noCz) {
      const need = markedMap(plan)[n].find((x) => x.box === r.box).qty
      sub += M.itemsInBox(st.alloc[n][r.box], need)
    } else if (plan.hasQty && plan.map[n]) {
      const need = plan.map[n].find((x) => x.box === r.box).qty
      sub += M.itemsInBox(st.alloc[n][r.box], need)
    }
    showTarget('ok', r.box, sub + (extra.noCz ? M.acceptedNoCz : ''), M.boxCaption)
    beep(true)
  } else {
    showTarget('err', UNK, shown + '\n' + (r.status === 'foreign' ? M.foreignCode : r.status === 'unknown' ? M.unknownGoods : M.extraGoods), M.notInFileBox)
    beep(false)
  }
  persist()
  emit()
}

export function undo() {
  const { st } = S
  for (let i = st.scans.length - 1; i >= 0; i--) {
    const s = st.scans[i]
    const cell = st.boxes[s.box]
    if (!cell || !cell.box || cell.box.code !== s.boxCode) continue
    const k = cell.items.map((x) => x.bc).lastIndexOf(s.bc)
    if (k >= 0) cell.items.splice(k, 1)
    st.scans.splice(i, 1)
    st.fact[s.box]--
    const pl = st.pend[s.box] || []
    const pi = pl.findIndex((o) => o.id === s.id)
    if (pi >= 0) {
      pl.splice(pi, 1)
      if (s.ki) enqueue({ op: 'undo', ref: s.id, ki: s.ki }) // скан ещё не ушёл, но код ЧЗ уже занят в таблице — освобождаем
    } else if (s.id) enqueue(s.ki ? { op: 'undo', ref: s.id, ki: s.ki } : { op: 'undo', ref: s.id })
    if (s.ki) {
      markReg.delete(s.ki)
      save('whf_marks', [...markReg])
    }
    if (s.status === 'ok') {
      const n = s.n || norm(s.bc)
      st.alloc[n][s.box]--
    }
    if (!cell.items.length && !cell.box.base && !cell.box.from) {
      cell.box = null
      delete st.pend[s.box]
    }
    S.hit = s.box
    showTarget('idle', M.cancelled, M.cancelledSub(s.bc, s.box))
    persist()
    emit()
    return
  }
  showTarget('err msg', M.nothingToUndo, M.nothingToUndoSub)
  beep(false)
}

export async function closeBox(k, silent) {
  const { st, cfg } = S
  const cell = st.boxes[k]
  if (!cell || !cell.box || !boxCount(cell)) return null
  if (!cell.box.code) {
    showTarget('err msg', M.wait, M.waitSub(k))
    return null
  }
  if (cell.box.closing) return null
  cell.box.closing = true
  emit()
  let s = cell.box.storage
  if (!s) {
    showTarget('idle', M.assigningPallet, cell.box.code)
    try {
      s = await api('assignPallet', { box: cell.box.code, cat: k, count: boxCount(cell), receipt: st.receipt, pc: cfg.worker || '' })
    } catch (e) {
      delete cell.box.closing
      emit()
      const full = /SECTOR_FULL:(\d+)/.exec(e.message)
      if (full) showTarget('err msg', M.sectorFull(full[1]), M.sectorFullSub, '', { text: M.continueOtherSector, fn: () => openSectorDlg(k) })
      else showTarget('err msg', M.boxNotClosed, e.message)
      beep(false)
      return null
    }
  }
  const tmp = cell.box.code
  const fin = s.box || tmp
  const rec = { code: fin, box: k, opened: cell.box.opened, closedAt: Date.now(), items: cell.items.map((x) => x.bc), count: boxCount(cell), storage: s, pallet: s.code }
  st.scans.forEach((x) => {
    if (x.boxCode === tmp) x.boxCode = fin
  })
  st.closed.unshift(rec)
  st.boxes[k] = { box: null, items: [] }
  palCache[rec.code] = s.code
  boxReg[rec.code] = { box: k, count: rec.count, receipt: st.receipt, closedAt: rec.closedAt, opened: rec.opened }
  save(BREG_KEY, boxReg)
  backend.closeBoxRecord(rec.code, { box: k, count: rec.count, receipt: st.receipt, opened: rec.opened })
  enqueue({ op: 'close', boxCode: rec.code, tmp, box: k, count: rec.count, opened: rec.opened, closedAt: rec.closedAt, receipt: st.receipt })
  persist()
  S.hit = k
  emit()
  showTarget('ok', s.pallet, M.closedSub(rec.code, rec.count, s), M.sectorToPallet(s.sector))
  beep(true)
  if (!silent && cfg.autoprint) printLabels([rec])
  return rec
}

export async function closeAll() {
  const open = openKeys()
  if (!open.length) return
  if (!(await ask(M.confirmCloseAll(open.length)))) return
  const recs = []
  for (const k of open) {
    const r = await closeBox(k, true)
    if (r) recs.push(r)
  }
  if (S.cfg.autoprint) printLabels(recs)
}

/* ---------- Печать ---------- */
export function printLabels(list) {
  if (!list.length) return
  printHTML(list.map((r) => labelHTML(r, P) + (r.storage && S.cfg.palLabel ? storLabelHTML(r.storage, P) : '')).join(''), P, focusScan)
}
export const printOpen = () =>
  printLabels(
    Object.keys(S.st.boxes)
      .sort(byNum)
      .filter((k) => S.st.boxes[k].box && S.st.boxes[k].box.code)
      .map((k) => ({ code: S.st.boxes[k].box.code, box: k, opened: S.st.boxes[k].box.opened })),
  )
export const printOne = (k) => {
  const c = S.st.boxes[k]
  printLabels([{ code: c.box.code, box: k, opened: c.box.opened }])
}
export const printClosed = (i) => printLabels([S.st.closed[i]])
export const printTest = () => printLabels([{ code: '005_0000', box: '5', opened: Date.now() }])

/* ---------- Выгрузки ---------- */
async function fetchPalMap(codes) {
  try {
    const m = await api('getBoxPallets', codes)
    Object.assign(palCache, m)
    return { map: m, ok: true }
  } catch {
    return { map: palCache, ok: false }
  }
}
export const getPalCache = () => palCache
export function refreshPalCache() {
  if (S.st.closed.length) fetchPalMap(S.st.closed.map((c) => c.code)).then(() => emit())
}

const rcpt = () => S.st.receipt
export function exportTxt() {
  if (!S.st.scans.length) return showTarget('err msg', M.listEmpty, M.listEmptySub)
  download(`barkody_${stamp(rcpt())}.txt`, allLines(S.st))
}
export function exportKiz() {
  if (!S.st.scans.some((s) => s.ki)) return showTarget('err msg', M.listEmpty, M.noCzInReceipt)
  download(`kiz_${stamp(rcpt())}.txt`, kizLines(S.st))
}
export async function exportCopy() {
  try {
    await navigator.clipboard.writeText(allLines(S.st))
  } catch {
    const ta = document.createElement('textarea')
    ta.value = allLines(S.st)
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
  showTarget('idle', M.copied, M.copiedSub(S.st.scans.length))
  focusScan()
}
export async function exportByBox() {
  const pm = await fetchPalMap([...new Set(S.st.scans.map((s) => s.boxCode))])
  download(`priemka_po_korobkam_${stamp(rcpt())}.csv`, byBoxCsv(S.st, S.cfg, pm), true)
}
export function exportDiff() {
  if (!S.plan) return
  download(`rashozhdeniya_${stamp(rcpt())}.csv`, diffCsv(S.st, S.plan), true)
}
export function exportUpdDiff() {
  download(`rashozhdeniya_UPD_${stamp(rcpt())}.csv`, updDiffCsv(S.plan, gtinEan), true)
}
export async function exportStorage() {
  try {
    const rows = (await api('storageList')).slice().sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'ru', { numeric: true }))
    download(`hranenie_${stamp(rcpt())}.csv`, toCsv([M.storageHeader, ...rows]), true)
  } catch (e) {
    showTarget('err msg', M.error, e.message)
    beep(false)
  }
}

/* ---------- Приёмки ---------- */
export function loadReceipts() {
  S.receiptsMsg = M.loadingList
  emit()
  api('listReceipts')
    .then((r) => {
      S.receipts = r
      S.receiptsMsg = ''
      emit()
    })
    .catch((e) => {
      S.receiptsMsg = M.noConnection(e.message)
      emit()
    })
}
export function openReceipts(prefill) {
  S.ui.receipts = true
  S.ui.receiptPrefill = prefill || ''
  emit()
  loadReceipts()
}
export function closeReceipts() {
  setUi({ receipts: false })
}

export async function switchReceipt(name) {
  name = String(name).trim()
  if (!name) return
  if (name === S.st.receipt) {
    closeReceipts()
    return
  }
  const open = openKeys()
  setUi({ receipts: false })
  let keep = { boxes: {}, pend: {} }
  if (open.length) {
    const list = open.map((k) => M.openBoxLine(S.st.boxes[k].box.code || M.boxWord(k), boxCount(S.st.boxes[k]))).join('\n')
    const c = await choose(M.openBoxesPrompt(list), [{ text: M.cancel }, { text: M.closeAndPrint }, { text: M.continueInNew, dark: true }])
    if (c <= 0) {
      openReceipts()
      return
    }
    if (c === 1) {
      const recs = []
      for (const k of open) {
        const r = await closeBox(k, true)
        if (r) recs.push(r)
      }
      if (S.cfg.autoprint) printLabels(recs)
      if (openKeys().length) {
        showTarget('err msg', M.notAllClosed, M.notAllClosedSub)
        return
      }
    } else keep = carryOver(S.st.receipt)
  }
  S.st = fresh(name)
  S.st.boxes = keep.boxes
  S.st.pend = keep.pend
  S.hit = null
  persist()
  emit()
  showTarget('idle', M.canScan, M.receiptSub(name, Object.keys(keep.boxes).length))
  focusScan()
}
export async function createReceipt(name) {
  const n = await api('createReceipt', name)
  await switchReceipt(n)
}
export async function finishReceipt(name) {
  setUi({ receipts: false })
  if (!(await ask(M.confirmFinish(name)))) {
    openReceipts()
    return
  }
  try {
    S.receipts = await api('finishReceipt', name)
  } catch (e) {
    window.alert(e.message)
  }
  openReceipts()
}

/* ---------- Дополнительные операции (ответственный, по ПИН) ---------- */
export function openSectorDlg(k) {
  S.ui.sectorsRetry = k || null
  S.ui.more = false
  S.ui.sectors = true
  emit()
}

export async function freePallet(raw) {
  let v = fixLayout(raw.trim().replace(/\s+/g, '')).toUpperCase()
  const m = /^S?(\d{1,2})[-_.]?P?(\d)$/.exec(v)
  if (m) v = `S${pad(+m[1], 2)}_P${m[2]}`
  if (!STOR_RE.test(v)) return { error: M.palletFormat }
  setUi({ more: false })
  if (!(await ask(M.confirmFreePallet(v)))) return { done: true }
  try {
    const r = await api('freePallet', v)
    showTarget('ok', v.slice(4), M.palletFreed(v, r.freed), M.sectorPalletFree(+v.slice(1, 3)))
    beep(true)
  } catch (e) {
    showTarget('err msg', M.error, e.message)
    beep(false)
  }
  return { done: true }
}

export async function reopenByCode(raw) {
  const code = fixLayout(raw.trim()).toUpperCase().trim()
  if (!BOX_RE.test(code)) return { error: M.notBoxLabel }
  if (!S.st.receipt) return { error: M.chooseReceiptFirst }
  const k0 = Object.keys(S.st.boxes).find((k) => S.st.boxes[k].box && S.st.boxes[k].box.code && boxId(S.st.boxes[k].box.code) === boxId(code))
  if (k0) return { error: M.boxAlreadyOpen(code, k0) }
  let info
  try {
    info = await api('boxInfo', code)
  } catch (e) {
    return { error: e.message }
  }
  if (!info) return { error: M.boxNotFound(code) }
  const k = info.box
  const cur = S.st.boxes[k]
  if (cur && cur.box && (cur.items.length || !cur.box.code)) return { error: M.otherBoxOpen(k, cur.box.code || '', boxCount(cur)) }
  setUi({ more: false })
  if (!(await ask(M.confirmReopen(code, k, info)))) return { done: true }
  try {
    const r = await api('reopenBox', code)
    S.st.boxes[k] = { box: { code, opened: r.opened || Date.now(), base: r.count, reopened: true, storage: r.storage || null }, items: [] }
    S.st.closed = S.st.closed.filter((c) => c.code !== code)
    delete boxReg[code]
    save(BREG_KEY, boxReg)
    S.hit = k
    persist()
    emit()
    showTarget('ok', k, M.reopenedSub(code, r.count), M.boxOpened)
    beep(true)
  } catch (e) {
    showTarget('err msg', M.error, e.message)
    beep(false)
  }
  return { done: true }
}

export async function importOldFile(file, pin) {
  if (!file) return { error: M.chooseImportFile }
  if (!/^\d{4}$/.test(pin)) return { error: M.enterPin }
  const rows = parseCsv(await file.text()).filter((r) => r.length > 1)
  const H = rows.shift() || []
  const ix = (n) => H.indexOf(n)
  const miss = M.importColumns.filter((n) => ix(n) < 0)
  if (miss.length) return { error: M.notImportFile(miss.join(', ')) }
  const g = (r, n) => (r[ix(n)] || '').trim()
  const receipt = g(rows[0], 'Приемка')
  const boxes = {}
  const scans = []
  for (const r of rows) {
    const code = g(r, 'Новый ШК короба')
    const t = parseRuTime(g(r, 'Время'))
    const b = (boxes[code] = boxes[code] || { code, cat: g(r, 'Категория'), state: g(r, 'Состояние короба'), pallet: g(r, 'Палет'), pos: g(r, 'Место'), pc: g(r, 'Сотрудник'), count: 0, opened: t, closed: t })
    b.count++
    b.opened = Math.min(b.opened, t)
    b.closed = Math.max(b.closed, t)
    scans.push({ t, pc: g(r, 'Сотрудник'), cat: b.cat, code, bc: g(r, 'Баркод'), status: g(r, 'Статус товара'), ki: g(r, 'КИ Честный знак'), full: g(r, 'Код ЧЗ полностью') })
  }
  const list = Object.values(boxes)
  const open = list.filter((b) => b.state !== 'закрыт')
  const busy = open.filter((b) => {
    const c = S.st.boxes[String(+b.cat || b.cat)]
    return c && c.box && boxCount(c)
  })
  if (busy.length) return { error: M.importBusy(busy.map((b) => +b.cat).join(', ')) }
  setUi({ more: false })
  if (!(await ask(M.confirmImport(receipt, list.length, list.length - open.length, open.length, scans.length)))) return { done: true }
  showTarget('idle', M.importing, M.importingSub(list.length, scans.length))
  try {
    const r = await api('importOld', { receipt, boxes: list, scans }, pin)
    for (const b of open) {
      const k = String(+b.cat || b.cat)
      S.st.boxes[k] = { box: { code: b.code, opened: b.opened, base: b.count, from: 'офлайн' }, items: [] }
    }
    scans.forEach((s) => {
      if (s.ki) markReg.add(s.ki)
    })
    save('whf_marks', [...markReg])
    persist()
    emit()
    showTarget('ok', M.done, M.importedSub(r, open.length), M.importWord)
    beep(true)
  } catch (e) {
    showTarget('err msg', M.importFailed, e.message)
    beep(false)
  }
  return { done: true }
}

export function closeSectorDlg() {
  setUi({ sectors: false, sectorsRetry: null })
}

export const sectorsApi = {
  list: () => api('listSectors'),
  add: (cat, sec, pin) => api('addSector', cat, sec, pin, S.plan ? S.plan.boxes : []),
  remove: (cat, sec, pin) => api('removeSector', cat, sec, pin),
}

/* ---------- Запуск и остановка ---------- */
let booted = false
export function boot() {
  if (booted) return
  booted = true
  refreshPalCache()
  Object.keys(S.st.boxes).forEach((k) => {
    const c = S.st.boxes[k]
    if (c.box && !c.box.code && c.items.length) {
      delete c.box.req
      requestBoxCode(k)
    }
  })
  if (S.plan) showTarget('idle', M.canScan, S.st.receipt ? M.receiptWord(S.st.receipt) : M.chooseReceiptTop)
}

