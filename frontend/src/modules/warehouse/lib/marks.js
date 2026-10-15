// Честный знак (DataMatrix): разбор кода, исправление раскладки, GTIN ↔ EAN.
// Перенесено из Index.html без изменений логики.
import { cellStr } from './format.js'

const GSC = '\u001d'
// Сканер в русской раскладке портит буквы кода — переводим обратно в английскую
const RU = 'ёйцукенгшщзхъфывапролджэячсмитьбюЁЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮ.,"№;:?'
const EN = '`qwertyuiop[]asdfghjkl;\'zxcvbnm,.~QWERTYUIOP{}ASDFGHJKL:"ZXCVBNM<>/?@#$^&'

export function fixLayout(s) {
  if (!/[А-Яа-яЁё]/.test(s)) return s
  let o = ''
  for (const ch of s) {
    const k = RU.indexOf(ch)
    o += k >= 0 ? EN[k] : ch
  }
  return o
}

export function isDM(s) {
  return /^(\]d2|\]C1|\]Q3)?(01\d{14}21.|\(01\)\d{14}\(21\).)/.test(s) && s.length >= 24
}

// Принимаются три вида: сырой с криптохвостом без GS, с GS (\x1d), со скобками (01)…(21)…
export function parseDM(raw) {
  const s = fixLayout(raw.trim())
    .replace(/^(\]d2|\]C1|\]Q3)/, '')
    .replace(/<GS>|\\x1d|\{GS\}/gi, GSC)
  const pm = /^\(01\)(\d{14})\(21\)(.+)$/.exec(s)
  if (pm) {
    const cut = pm[2].search(/\(9[1-3]\)/)
    const serial = cut >= 6 ? pm[2].slice(0, cut) : pm[2]
    return { gtin: pm[1], serial, ki: '01' + pm[1] + '21' + serial, full: s }
  }
  const m = /^01(\d{14})21/.exec(s)
  if (!m) return null
  const gtin = m[1]
  const rest = s.slice(18)
  let serial
  const g = rest.indexOf(GSC)
  if (g >= 0) serial = rest.slice(0, g)
  else {
    // символ-разделитель потерян: подбираем длину серийного номера
    for (const L of [13, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20]) {
      const tail = rest.slice(L)
      if (rest.length >= L && (tail === '' || /^(91|92|93)/.test(tail))) {
        serial = rest.slice(0, L)
        break
      }
    }
    if (serial === undefined) serial = rest.slice(0, Math.min(20, rest.length))
  }
  if (!serial) return null
  return { gtin, serial, ki: '01' + gtin + '21' + serial, full: s.split(GSC).join('<GS>') }
}

// Код ЧЗ из ячейки Excel (любой формат) → КИ, иначе null
export function kiOf(v) {
  const s = cellStr(v)
  if (!s || !isDM(s)) return null
  const p = parseDM(s)
  return p ? p.ki : null
}

// GTIN 04620270011115 = EAN 4620270011115
export const gtinEan = (g) => String(g).replace(/^0+(?=\d{13}$)/, '')
