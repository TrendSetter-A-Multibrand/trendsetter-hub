// Выгрузки и CSV. Перенесено из Index.html без изменений логики; состояние передаётся параметрами.
import { pad, fmtTime, norm } from './format.js'
import { eanOf, markedMap } from './plan.js'

export const STATUS = { ok: 'в файле', unknown: 'нет в файле', extra: 'излишек', foreign: 'нет в файле (чужой код ЧЗ)' }

export const toCsv = (rows) => rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n')

export function parseCsv(text) {
  text = text.replace(/^﻿/, '')
  const rows = []
  let row = []
  let f = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          f += '"'
          i++
        } else q = false
      } else f += ch
    } else if (ch === '"') q = true
    else if (ch === ';') {
      row.push(f)
      f = ''
    } else if (ch === '\n') {
      row.push(f)
      rows.push(row)
      row = []
      f = ''
    } else if (ch !== '\r') f += ch
  }
  if (f !== '' || row.length) {
    row.push(f)
    rows.push(row)
  }
  return rows
}

export const parseRuTime = (s) => {
  const m = /(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/.exec(s || '')
  return m ? new Date(+m[3], m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)).getTime() : Date.now()
}

export function stamp(receipt) {
  const d = new Date()
  const r = (receipt || '').replace(/[^0-9A-Za-zА-Яа-яЁё_-]+/g, '_').slice(0, 40)
  return `${r ? r + '_' : ''}${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`
}

export function download(name, text, bom) {
  const blob = new Blob([(bom ? '﻿' : '') + text], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    URL.revokeObjectURL(a.href)
    a.remove()
  }, 500)
}

export const allLines = (st) => st.scans.map((s) => s.ean || s.bc).join('\r\n')
export const kizLines = (st) =>
  st.scans
    .filter((s) => s.ki)
    .map((s) => s.ki)
    .join('\r\n')

function palOf(st, code, map, ok) {
  if (map[code]) return map[code]
  if (!st.closed.some((c) => c.code === code)) return 'короб не закрыт'
  return ok ? 'НЕТ ПАЛЕТА' : 'не проверено (нет связи)'
}

export function byBoxCsv(st, cfg, { map, ok }) {
  const closed = new Set(st.closed.map((c) => c.code))
  return toCsv([
    ['Приемка', 'Сотрудник', 'Коробка', 'ШК короба', 'Палет', 'Баркод', 'КИ Честный знак', 'Код ЧЗ полностью', 'Время', 'Статус товара', 'Статус короба'],
    ...st.scans.map((s) => [
      st.receipt,
      s.worker || cfg.worker || '',
      s.box,
      s.boxCode,
      palOf(st, s.boxCode, map, ok),
      s.ean || s.bc,
      s.ki || '',
      s.full || '',
      fmtTime(s.t),
      STATUS[s.status] + (s.noCz ? ', без ЧЗ' : ''),
      closed.has(s.boxCode) ? 'закрыт' : 'открыт',
    ]),
  ])
}

export function diffCsv(st, plan) {
  const rows = [['ШК / КИ', 'Коробка по файлу', 'Ожидалось', 'Отсканировано', 'Разница', 'Баркод']]
  for (const n in plan.map)
    for (const e of plan.map[n]) {
      const got = (st.alloc[n] && st.alloc[n][e.box]) || 0
      if (plan.hasQty) rows.push([e.raw, e.box, e.qty, got, got - e.qty])
      else rows.push([e.raw, e.box, '', got, ''])
    }
  if (plan.kiMap) {
    const got = new Set(st.scans.filter((s) => s.ki && s.status === 'ok').map((s) => s.ki))
    for (const k in plan.kiMap)
      rows.push([k, plan.kiMap[k], 1, got.has(k) ? 1 : 0, got.has(k) ? 0 : -1, eanOf(plan, k, k.slice(2, 16))])
  }
  const nc = {}
  for (const s of st.scans)
    if (s.noCz && s.status === 'ok') {
      const k = s.bc + '|' + s.box
      nc[k] = nc[k] || { bc: s.bc, box: s.box, n: 0 }
      nc[k].n++
    }
  for (const k in nc) {
    const x = nc[k]
    const need = (markedMap(plan)[norm(x.bc)] || []).find((e) => e.box === x.box)
    rows.push([x.bc, x.box + ' (принято без ЧЗ)', need ? need.qty : '', x.n, '', x.bc])
  }
  const extra = {}
  for (const s of st.scans)
    if (s.status !== 'ok') {
      const key = s.bc + '|' + s.status
      extra[key] = extra[key] || { bc: s.bc, ean: s.ean || s.bc, st: s.status, n: 0 }
      extra[key].n++
    }
  for (const k in extra) {
    const x = extra[k]
    rows.push([x.bc, x.st === 'extra' ? 'излишек → 20' : STATUS[x.st] + ' → 20', '', x.n, '+' + x.n, x.ean])
  }
  return toCsv(rows)
}

// Расхождения «шаблон / УПД»
export function updDiffCsv(plan, gtinEan) {
  return toCsv([
    ['КИ', 'Где есть', 'Коробка по шаблону', 'Баркод'],
    ...plan.upd.onlyFile.map((k) => [k, 'только в шаблоне', plan.kiMap[k], eanOf(plan, k, k.slice(2, 16))]),
    ...plan.upd.onlyUpd.map((k) => [k, 'только в УПД', '', gtinEan(k.slice(2, 16))]),
  ])
}
