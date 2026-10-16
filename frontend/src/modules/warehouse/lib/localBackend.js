// Локальный бэкенд модуля «Склад»: те же функции, что в серверной части исходного приложения (Code.gs),
// но данные хранятся в localStorage этого браузера. TODO(DB): позже заменить на запросы к серверу
// (см. docs «Перенос в свою БД»: транзакции для номера короба, палета, кода ЧЗ, приёмки, доп. секции).
import { pad, fmtTime, boxPart } from './format.js'

export const CAP = (p) => (p <= 3 ? 16 : 12) // палеты 1–3 вмещают 16 коробов, 4–6 — 12
export const PALLETS = 6
// ПИН ответственного для демо. В рабочей версии его проверяет сервер, в репозитории настоящего ПИНа нет.
export const DEMO_PIN = '1234'

const STORE_KEY = 'whf_store'
const empty = () => ({ rows: [], ptr: {}, arch: [], ext: {}, seq: {}, marks: {}, receipts: [], boxReg: {} })

const read = () => {
  try {
    const v = localStorage.getItem(STORE_KEY)
    return Object.assign(empty(), v ? JSON.parse(v) : {})
  } catch {
    return empty()
  }
}
let LS = read()
const persist = () => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(LS))
  } catch {
    // переполнение localStorage в демо не критично
  }
}

export function storInfo(code, rows, box) {
  const sec = code.slice(1, 3)
  const p = +code.split('_P')[1]
  const on = rows.filter((r) => r.code === code)
  const pos = box ? on.findIndex((r) => r.box === box) + 1 : on.length
  return { code, sector: sec, pallet: p, pos, cap: CAP(p), box: box || '' }
}

const checkPin = (pin) => {
  if (String(pin) !== DEMO_PIN) throw new Error('Неверный ПИН')
}

export const backend = {
  shared: false, // данные только в этом браузере: нет общей раскладки приёмки между ПК

  getInit() {
    return { email: 'локальный режим' }
  },

  // Операции sync выполняются клиентом сразу; здесь только то, что нужно серверу: реестр закрытых коробов и освобождение КИ
  sync(ops) {
    for (const o of ops) {
      if (o.op === 'undo' && o.ki) delete LS.marks[o.ki]
    }
    persist()
    return { ok: true }
  },

  nextBoxCode(box) {
    const part = boxPart(box)
    const key = 'BOX_' + part
    LS.seq[key] = (LS.seq[key] || 0) + 1
    persist()
    return part + '_' + pad(LS.seq[key], 4)
  },

  assignPallet(o) {
    const ex = LS.rows.find((r) => r.box === o.box)
    if (ex) return storInfo(ex.code, LS.rows, o.box) // короб уже стоит (повторное закрытие)
    const cat = boxPart(o.cat)
    for (const sec of [cat, ...(LS.ext[cat] || [])]) {
      const cnt = {}
      LS.rows.filter((r) => r.sector === sec).forEach((r) => (cnt[r.p] = (cnt[r.p] || 0) + 1))
      const cur = LS.ptr[sec] || 1
      let p = 0
      for (let k = 0; k < PALLETS; k++) {
        const q = ((cur - 1 + k) % PALLETS) + 1
        if ((cnt[q] || 0) < CAP(q)) {
          p = q
          break
        }
      }
      if (!p) continue
      LS.ptr[sec] = p
      const code = `S${sec}_P${p}`
      const fin = `S${sec}_K${cat}_P${p}_${String(o.box).split('_').pop()}`
      LS.rows.push({ code, box: fin, sector: sec, p, count: o.count, t: Date.now(), receipt: o.receipt, cat })
      LS.boxReg[fin] = { box: String(+cat || cat), count: o.count, receipt: o.receipt, opened: Date.now() }
      persist()
      return storInfo(code, LS.rows, fin)
    }
    throw new Error(`SECTOR_FULL:${+cat} Секция полностью заполнена. Обратитесь к ответственному склада.`)
  },

  registerMark(m) {
    const f = LS.marks[m.ki]
    if (f) return { status: 'dup', at: f.at, pc: f.pc, box: f.box, receipt: f.receipt }
    LS.marks[m.ki] = { at: fmtTime(Date.now()).slice(0, 16), pc: m.pc || '', box: String(m.box), receipt: m.receipt || '' }
    persist()
    return { status: 'ok' }
  },

  boxInfo(code) {
    const r = LS.boxReg[code]
    const s = LS.rows.find((x) => x.box === code)
    return r ? { box: r.box, count: r.count, pallet: s ? s.code : '', receipt: r.receipt } : null
  },

  // Повторно открыть закрытый короб: палет сохраняется, при закрытии вернётся с общим количеством
  reopenBox(code) {
    const r = LS.boxReg[code]
    if (!r) throw new Error(`Короб ${code} не найден среди закрытых`)
    const s = LS.rows.find((x) => x.box === code)
    return { box: r.box, count: r.count, opened: r.opened, storage: s ? storInfo(s.code, LS.rows, code) : null }
  },

  closeBoxRecord(code, info) {
    LS.boxReg[code] = Object.assign(LS.boxReg[code] || {}, info)
    persist()
  },

  getBoxPallets(codes) {
    const m = {}
    LS.rows.forEach((r) => {
      if (codes.includes(r.box)) m[r.box] = r.code
    })
    return m
  },

  storageList() {
    return LS.rows.map((r) => [r.code, r.sector, r.p, r.box, r.count, fmtTime(r.t).slice(0, 16), r.receipt, r.cat || ''])
  },

  freePallet(code) {
    const idx = LS.rows.filter((r) => r.code === code)
    LS.arch.push(...idx.map((r) => ({ ...r, freedAt: Date.now() })))
    LS.rows = LS.rows.filter((r) => r.code !== code)
    persist()
    return { freed: idx.length }
  },

  listSectors() {
    const out = []
    for (const c in LS.ext) LS.ext[c].forEach((s) => out.push({ cat: c, sector: s, boxes: LS.rows.filter((r) => r.sector === s).length }))
    return out
  },

  addSector(cat, sector, pin, known) {
    checkPin(pin)
    cat = boxPart(cat)
    sector = boxPart(sector)
    if (sector === cat) throw new Error(`Секция ${+sector} и так основная для категории ${+cat}`)
    const cats = {}
    ;(known || []).forEach((k) => (cats[boxPart(k)] = 1))
    LS.rows.forEach((r) => {
      if (r.cat) cats[boxPart(r.cat)] = 1
    })
    if (cats[sector]) throw new Error(`Секция ${+sector} — основная секция категории ${+sector}`)
    for (const c in LS.ext) if (LS.ext[c].includes(sector)) throw new Error(`Секция ${+sector} уже отдана категории ${+c}`)
    if (LS.rows.some((r) => r.sector === sector && r.cat !== cat)) throw new Error(`В секции ${+sector} уже стоят короба другой категории`)
    ;(LS.ext[cat] = LS.ext[cat] || []).push(sector)
    persist()
    return backend.listSectors()
  },

  removeSector(cat, sector, pin) {
    checkPin(pin)
    cat = boxPart(cat)
    sector = boxPart(sector)
    if (LS.rows.some((r) => r.sector === sector)) throw new Error(`В секции ${+sector} ещё стоят короба — сначала освободите его палеты`)
    LS.ext[cat] = (LS.ext[cat] || []).filter((s) => s !== sector)
    persist()
    return backend.listSectors()
  },

  // Разовый импорт из офлайн-версии, с проверкой конфликтов
  importOld(d, pin) {
    checkPin(pin)
    const boxes = d.boxes || []
    const scans = d.scans || []
    const codes = {}
    boxes.forEach((b) => (codes[b.code] = 1))
    const taken = LS.rows.filter((r) => codes[r.box]).map((r) => r.box)
    if (taken.length) throw new Error(`Короба уже есть в таблице (например ${taken[0]}). Импорт уже сделан или номера заняты тестовыми данными.`)
    const maxSeq = {}
    boxes.forEach((b) => {
      const k = 'BOX_' + boxPart(b.cat)
      maxSeq[k] = Math.max(maxSeq[k] || 0, Number(b.code.split('_').pop()))
    })
    for (const k in maxSeq) if ((LS.seq[k] || 0) > 0) throw new Error(`Счётчик ${k} уже = ${LS.seq[k]}. Номера пересекутся.`)
    const need = {}
    boxes.forEach((b) => {
      if (b.state === 'закрыт') need[b.pallet] = 1
    })
    LS.rows.forEach((r) => {
      if (need[r.code]) throw new Error(`На палете ${r.code} уже стоят короба — импорт рассчитан на пустой палет.`)
    })
    const dupKi = scans.filter((s) => s.ki && LS.marks[s.ki])
    if (dupKi.length) throw new Error(`Коды ЧЗ уже приняты: ${dupKi.length} шт (например ${dupKi[0].ki}).`)
    const closed = boxes.filter((b) => b.state === 'закрыт').sort((a, b) => Number(a.pos) - Number(b.pos))
    closed.forEach((b) => {
      LS.rows.push({ code: b.pallet, box: b.code, sector: b.pallet.slice(1, 3), p: Number(b.pallet.split('_P')[1]), count: b.count, t: b.closed, receipt: d.receipt, cat: boxPart(b.cat) })
      LS.boxReg[b.code] = { box: String(+b.cat || b.cat), count: b.count, receipt: d.receipt, opened: b.opened }
    })
    const mk = scans.filter((s) => s.ki)
    mk.forEach((s) => (LS.marks[s.ki] = { at: fmtTime(s.t).slice(0, 16), pc: s.pc || '', box: s.code, receipt: d.receipt }))
    for (const k in maxSeq) LS.seq[k] = Math.max(LS.seq[k] || 0, maxSeq[k])
    closed.forEach((b) => {
      const sec = b.pallet.slice(1, 3)
      if (!LS.ptr[sec]) LS.ptr[sec] = Number(b.pallet.split('_P')[1])
    })
    if (!LS.receipts.some((r) => r.name === d.receipt)) LS.receipts.push({ name: d.receipt, created: fmtTime(Date.now()).slice(0, 16), by: 'импорт', status: 'открыта' })
    persist()
    return { boxes: boxes.length, scans: scans.length, marks: mk.length }
  },

  listReceipts() {
    return LS.receipts.filter((r) => r.status === 'открыта').map((r) => ({ name: r.name, created: r.created, by: r.by })).reverse()
  },

  createReceipt(name) {
    name = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 80)
    if (!name) throw new Error('Пустое название')
    const ex = LS.receipts.find((r) => r.name.toLowerCase() === name.toLowerCase())
    if (ex) {
      ex.status = 'открыта'
      persist()
      return ex.name
    }
    LS.receipts.push({ name, created: fmtTime(Date.now()).slice(0, 16), by: 'этот браузер', status: 'открыта' })
    persist()
    return name
  },

  finishReceipt(name) {
    LS.receipts.forEach((r) => {
      if (r.name === name) r.status = 'завершена'
    })
    persist()
    return backend.listReceipts()
  },
}

// Сброс тестовых данных этого браузера (для проверки «с нуля»)
export function resetLocalBackend() {
  LS = empty()
  persist()
}
