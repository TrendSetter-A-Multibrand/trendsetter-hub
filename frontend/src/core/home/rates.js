// Курсы ЦБ РФ на главной: чистые функции, без React. Данные — GET /core/home/rates.
const money = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const EPS = 0.005

// [{ code, label: '100 AMD', value: '22,30 ₽', delta: '−0,15', direction: 'up' | 'down' | 'flat' }]
export function rateRows(data) {
  return (data?.rates ?? []).map((r) => {
    const diff = r.value - r.previous
    const direction = Math.abs(diff) < EPS ? 'flat' : diff > 0 ? 'up' : 'down'
    const sign = direction === 'up' ? '+' : direction === 'down' ? '−' : ''
    return {
      code: r.code,
      label: `${r.nominal} ${r.code}`,
      value: `${money.format(r.value)} ₽`,
      delta: `${sign}${money.format(direction === 'flat' ? 0 : Math.abs(diff))}`,
      direction,
    }
  })
}
