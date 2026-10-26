// Погода на главной: чистые функции, без React. Данные приходят с бэкенда (GET /core/home/weather).
import { parseIso } from '../dates.js'
import strings from '../strings.js'

const s = strings.hub.home

// Вид погоды по коду MET (без суффикса _day/_night). Порядок проверки важен.
export function weatherKind(symbol) {
  if (typeof symbol !== 'string' || !symbol) return null
  if (symbol.includes('thunder')) return 'thunder'
  if (symbol.includes('sleet')) return 'sleet'
  if (symbol.includes('snow')) return 'snow'
  if (symbol.includes('rain') || symbol.includes('showers')) return 'rain'
  if (symbol.includes('fog')) return 'fog'
  if (symbol.includes('partlycloudy') || symbol.includes('fair')) return 'partly'
  if (symbol.includes('cloudy')) return 'cloudy'
  if (symbol.includes('clearsky')) return 'clear'
  return null
}

// 5 -> '+5°', 0 -> '0°', -3 -> '−3°' (минус U+2212)
export function formatTemp(n) {
  if (n > 0) return `+${n}°`
  if (n < 0) return `−${Math.abs(n)}°`
  return '0°'
}

// '2026-10-26' -> 'пн 26' (день недели по календарной дате, без часового пояса браузера)
export function dayLabel(iso) {
  const p = parseIso(iso)
  if (!p) return ''
  return `${s.weekdays[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]} ${p.d}`
}
