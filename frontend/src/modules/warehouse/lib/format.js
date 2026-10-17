// Мелкие чистые функции. Перенесены из Index.html «Склад-приёмка» без изменений логики.
export const UNK = '20' // коробка для товара, которого нет в файле

export const pad = (n, l = 2) => String(n).padStart(l, '0')

export const fmtTime = (t) => {
  const d = new Date(t)
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c])

// Ведущие нули Excel часто съедает
export const norm = (s) => {
  s = String(s).trim().replace(/\s+/g, '')
  const t = s.replace(/^0+/, '')
  return t || s
}

export const byNum = (a, b) => {
  const x = parseFloat(a)
  const y = parseFloat(b)
  return isNaN(x) || isNaN(y) ? String(a).localeCompare(String(b), 'ru') : x - y
}

export const cellStr = (v) => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return String(v)
  return String(v).trim()
}

export const boxKey = (v) => {
  const s = cellStr(v)
  if (!s) return ''
  const m = s.match(/^\D*?(\d+)\D*$/)
  return m ? String(parseInt(m[1], 10)) : s
}

export const colName = (i) => {
  let s = ''
  i++
  while (i > 0) {
    const m = (i - 1) % 26
    s = String.fromCharCode(65 + m) + s
    i = Math.floor((i - 1) / 26)
  }
  return s
}

// Номер категории для ШК короба: 5 → 05, а нецифровые значения очищаются
export const boxPart = (k) => (/^\d+$/.test(k) ? pad(+k, 2) : String(k).replace(/[^0-9A-Za-z-]/g, ''))

// Открытый короб: 01_0014 (категория_номер). Закрытый: S01_K01_P1_0014 (секция, категория, палет, номер)
export const BOX_RE = /^(S\d{2}_K\d{2}_P\d_\d{4,}|[0-9A-Za-z-]+_\d{4,})$/i
export const STOR_RE = /^S\d{2}_P[1-6]$/i // этикетка палета хранения, например S05_P2
export const boxId = (c) => {
  c = String(c).trim().toUpperCase()
  const m = /^S\d{2}_K(\d{2})_P\d_(\d{4,})$/.exec(c)
  return m ? m[1] + '_' + m[2] : c
}
