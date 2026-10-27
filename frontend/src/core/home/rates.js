// Курсы ЦБ РФ на главной: чистые функции, без React. Данные — GET /core/home/rates.
import strings from '../strings.js'

const s = strings.hub.home
const money = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const EPS = 0.005

// [{ code, label: '1 USD', value: '81,12 ₽', delta: '+0,14', direction: 'up' | 'down' | 'flat' }]
// AMD показывается обратным курсом: «1 RUB = X AMD», X = номинал / курс; дельта — изменение X относительно предыдущего дня.
export function rateRows(data) {
  return (data?.rates ?? []).map((r) => {
    if (r.code === 'AMD') return amdRow(r)
    return row(r.code, `${r.nominal} ${r.code}`, r.value, r.previous, '₽')
  })
}

function amdRow(r) {
  const value = r.nominal / r.value
  const previous = r.nominal / r.previous
  return row(r.code, s.ratesRubLabel, value, previous, s.ratesAmdUnit)
}

function row(code, label, value, previous, unit) {
  const diff = value - previous
  const direction = Math.abs(diff) < EPS ? 'flat' : diff > 0 ? 'up' : 'down'
  const sign = direction === 'up' ? '+' : direction === 'down' ? '−' : ''
  return {
    code,
    label,
    value: `${money.format(value)} ${unit}`,
    delta: `${sign}${money.format(direction === 'flat' ? 0 : Math.abs(diff))}`,
    direction,
  }
}
