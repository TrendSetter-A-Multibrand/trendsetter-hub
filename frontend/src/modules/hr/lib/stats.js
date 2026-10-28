// Чистые функции сводки HR (кольца, проценты, стаж). Без React.
import strings from '../strings.js'

const s = strings.stats

// 5 цветов брендбука + серый для «Другие» (последний)
export const SLICE_COLORS = ['#1D428A', '#FE5000', '#005844', '#E59BDC', '#7CE0D3', '#B3ACA9']
const OTHERS_COLOR = SLICE_COLORS[SLICE_COLORS.length - 1]

// items: [{ count, ... }], labelOf(item) -> подпись. Сектора > 0; всё сверх max-1 складывается в «Другие» ({ rest: сколько схлопнули }).
export function toDonutItems(items, labelOf, max = 6) {
  const live = items.filter((i) => i.count > 0).map((i) => ({ label: labelOf(i), value: i.count }))
  if (live.length <= max) return live
  const head = live.slice(0, max - 1)
  const tail = live.slice(max - 1)
  return [...head, { label: s.others, value: tail.reduce((sum, i) => sum + i.value, 0), rest: tail.length }]
}

// Целый процент; сумма по секторам может не равняться 100 — так и показываем
export const pct = (value, sum) => (sum > 0 ? Math.round((value / sum) * 100) : 0)

// 29 -> «2 г. 5 мес.», 12 -> «1 г.», 8 -> «8 мес.», 0 -> «0 мес.»
export function formatTenure(months) {
  const y = Math.floor(months / 12)
  const m = months % 12
  if (y === 0) return `${m} ${s.monthShort}`
  return m === 0 ? `${y} ${s.yearShort}` : `${y} ${s.yearShort} ${m} ${s.monthShort}`
}

// Дуги кольца из готового массива (смещение — сумма предыдущих, без накопления при рендере)
export function donutArcs(items, size = 120, stroke = 18) {
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const total = items.reduce((sum, i) => sum + i.value, 0)
  return items.map((item, index) => {
    const before = items.slice(0, index).reduce((sum, i) => sum + i.value, 0)
    const share = total > 0 ? item.value / total : 0
    return {
      ...item,
      share,
      r,
      circumference,
      length: share * circumference,
      offset: total > 0 ? (before / total) * circumference : 0,
      color: item.rest !== undefined ? OTHERS_COLOR : SLICE_COLORS[index % (SLICE_COLORS.length - 1)],
    }
  })
}
