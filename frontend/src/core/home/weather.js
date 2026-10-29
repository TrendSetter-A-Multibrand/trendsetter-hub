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

// ---- «Сегодня»: окна и подсказка (docs/TZ-home-weather.md). Правила детерминированы, тексты — в strings.js ----

// От самого «тяжёлого» вида погоды к самому лёгкому
export const KIND_SEVERITY = ['thunder', 'sleet', 'snow', 'rain', 'fog', 'cloudy', 'partly', 'clear']

export const ICE_TEMP_MIN = -2
export const ICE_TEMP_MAX = 1
export const RAIN_MM = 0.3
export const WET_MM = 0.1
export const WIND_MS = 10
export const FROST_C = -10
// TODO(Q-W4): порог жары 33 °C (решение пользователя: в Ереване +30 бывает почти каждый день)
export const HEAT_C = 33
export const MIN_VARIANTS = 3

const WET_KINDS = ['rain', 'sleet', 'snow', 'thunder']

const kindsOf = (slot) => (slot.symbols ?? []).map(weatherKind).filter(Boolean)

// Самый «тяжёлый» вид среди символов окна; видов нет — null
export function slotKind(slot) {
  const kinds = kindsOf(slot)
  return KIND_SEVERITY.find((k) => kinds.includes(k)) ?? null
}

const wet = (slot) => kindsOf(slot).some((k) => WET_KINDS.includes(k)) || (slot.precip ?? 0) >= WET_MM

const heavy = (slot, kind) => (slot.symbols ?? []).some((code) => code.startsWith('heavy') && weatherKind(code) === kind)

// Первое подходящее правило для оставшихся окон дня или null. slots — today.slots с бэкенда.
export function adviceFor(slots) {
  if (slots.length > 0 && slots.every((sl) => sl.past)) return { rule: 'late', when: null, t: null }
  const rest = slots.filter((sl) => !sl.past && sl.temp !== null)
  if (rest.length === 0) return null

  // когда: во всех оставшихся окнах (их не меньше двух) — весь день, иначе первое окно по времени
  const when = (pred) => {
    const hits = rest.filter(pred)
    if (hits.length === 0) return null
    return hits.length === rest.length && rest.length >= 2 ? 'allDay' : hits[0].id
  }
  const byWhen = (rule, pred) => {
    const w = when(pred)
    return w ? { rule, when: w, t: null } : null
  }

  const simple = [
    ['thunder', (sl) => slotKind(sl) === 'thunder'],
    ['ice', (sl) => wet(sl) && sl.tempMin <= ICE_TEMP_MAX && sl.tempMax >= ICE_TEMP_MIN],
  ]
  const afterFreeze = [
    ['heavySnow', (sl) => heavy(sl, 'snow')],
    ['sleet', (sl) => slotKind(sl) === 'sleet'],
    ['snow', (sl) => slotKind(sl) === 'snow'],
    ['heavyRain', (sl) => heavy(sl, 'rain')],
    ['rain', (sl) => slotKind(sl) === 'rain' || (sl.precip ?? 0) >= RAIN_MM],
    ['wind', (sl) => sl.wind !== null && sl.wind >= WIND_MS],
  ]

  for (const [rule, pred] of simple) {
    const found = byWhen(rule, pred)
    if (found) return found
  }

  // после дождя подморозит: мокрое окно выше нуля, позже сухое окно с температурой не выше нуля
  for (let i = 0; i < rest.length; i += 1) {
    if (!(wet(rest[i]) && rest[i].tempMin > 0)) continue
    const dry = rest.slice(i + 1).find((sl) => !wet(sl) && sl.tempMin <= 0)
    if (dry) return { rule: 'freeze', when: dry.id, t: null }
  }

  for (const [rule, pred] of afterFreeze) {
    const found = byWhen(rule, pred)
    if (found) return found
  }

  const lowest = Math.min(...rest.map((sl) => sl.tempMin ?? sl.temp))
  if (lowest <= FROST_C) return { rule: 'frost', when: null, t: formatTemp(lowest) }
  const highest = Math.max(...rest.map((sl) => sl.tempMax ?? sl.temp))
  if (highest >= HEAT_C) return { rule: 'heat', when: null, t: formatTemp(highest) }

  const fog = byWhen('fog', (sl) => slotKind(sl) === 'fog')
  if (fog) return fog
  if (rest.every((sl) => ['clear', 'partly'].includes(slotKind(sl)))) return { rule: 'clear', when: null, t: null }
  return { rule: 'cloudy', when: null, t: null }
}

// FNV-1a, 32 бита
export function hashString(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

// Вариант фразы стабилен для (дата города, правило, город): без случайности и без текущего времени
export function adviceText(advice, { date, cityId }) {
  const variants = s.advice[advice.rule]
  const index = hashString(`${date}|${advice.rule}|${cityId}`) % variants.length
  return variants[index]({ when: s.adviceWhen[advice.when], t: advice.t })
}
