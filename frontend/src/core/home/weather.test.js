import test from 'node:test'
import assert from 'node:assert/strict'
import strings from '../strings.js'
import {
  FROST_C,
  HEAT_C,
  KIND_SEVERITY,
  MIN_VARIANTS,
  RAIN_MM,
  WIND_MS,
  adviceFor,
  adviceText,
  dayLabel,
  formatTemp,
  hashString,
  slotKind,
  weatherKind,
} from './weather.js'

const s = strings.hub.home

test('weatherKind: все ветви и порядок проверки', () => {
  const cases = {
    clearsky: 'clear',
    fair: 'partly',
    partlycloudy: 'partly',
    cloudy: 'cloudy',
    fog: 'fog',
    lightrain: 'rain',
    heavyrainshowers: 'rain',
    rainshowers: 'rain',
    lightsleet: 'sleet',
    lightrainandthunder: 'thunder',
    heavysnowandthunder: 'thunder',
    lightsnow: 'snow',
    lightsnowshowers: 'snow',
    lightrainshowersandsleet: 'sleet',
  }
  for (const [symbol, kind] of Object.entries(cases)) assert.equal(weatherKind(symbol), kind, symbol)
  assert.equal(weatherKind('unknown'), null)
  assert.equal(weatherKind(null), null)
  assert.equal(weatherKind(undefined), null)
})

test('formatTemp: плюс, ноль, минус U+2212', () => {
  assert.equal(formatTemp(5), '+5°')
  assert.equal(formatTemp(0), '0°')
  assert.equal(formatTemp(-3), '−3°')
})

test('dayLabel: день недели и число по календарной дате', () => {
  assert.equal(dayLabel('2026-10-26'), 'пн 26')
  assert.equal(dayLabel('2026-11-01'), 'вс 1')
  assert.equal(dayLabel('2026-10-31'), 'сб 31')
  assert.equal(dayLabel('bad'), '')
})

// ---- подсказка «Сегодня» ----

const ORDER = ['morning', 'noon', 'lunch', 'evening']
const mk = (id, o = {}) => ({
  id,
  past: false,
  temp: 10,
  tempMin: 10,
  tempMax: 10,
  symbols: ['cloudy'],
  precip: 0,
  wind: 2,
  ...o,
})
// Окна дня: заданные переопределены, остальные — прошедшие и пустые
const day = (over = {}) =>
  ORDER.map((id) =>
    over[id] ? mk(id, over[id]) : { id, past: true, temp: null, tempMin: null, tempMax: null, symbols: [], precip: null, wind: null },
  )
const rule = (slots) => adviceFor(slots)?.rule

test('slotKind: порядок тяжести и пустое окно', () => {
  assert.deepEqual(KIND_SEVERITY, ['thunder', 'sleet', 'snow', 'rain', 'fog', 'cloudy', 'partly', 'clear'])
  assert.equal(slotKind({ symbols: ['clearsky', 'cloudy', 'lightrain'] }), 'rain')
  assert.equal(slotKind({ symbols: ['rain', 'snow'] }), 'snow')
  assert.equal(slotKind({ symbols: ['snow', 'sleet'] }), 'sleet')
  assert.equal(slotKind({ symbols: ['sleet', 'rainandthunder'] }), 'thunder')
  assert.equal(slotKind({ symbols: ['fair', 'fog'] }), 'fog')
  assert.equal(slotKind({ symbols: ['clearsky', 'fair'] }), 'partly')
  assert.equal(slotKind({ symbols: [] }), null)
})

test('adviceFor: late и null', () => {
  assert.equal(rule(day()), 'late')
  assert.equal(adviceFor([]), null)
  assert.equal(adviceFor(day({ lunch: { temp: null, tempMin: null, tempMax: null, symbols: [] } })), null)
})

test('adviceFor: thunder и его приоритет', () => {
  assert.deepEqual(adviceFor(day({ lunch: { symbols: ['lightrain', 'heavyrainandthunder'] } })), { rule: 'thunder', when: 'lunch', t: null })
  assert.equal(rule(day({ lunch: { symbols: ['rain', 'thunder'] } })), 'thunder')
  assert.notEqual(rule(day({ lunch: { symbols: ['rain'], precip: 1 } })), 'thunder')
})

test('adviceFor: ice — границы температуры и осадков', () => {
  const wetSlot = (tempMin, tempMax) => day({ lunch: { symbols: ['rain'], precip: 1, tempMin, tempMax, temp: tempMin } })
  assert.equal(rule(wetSlot(1, 3)), 'ice')
  assert.equal(rule(wetSlot(2, 3)), 'rain')
  assert.equal(rule(wetSlot(-5, -2)), 'ice')
  assert.equal(rule(wetSlot(-5, -3)), 'rain')
  assert.equal(rule(day({ lunch: { symbols: ['cloudy'], precip: 0.1, tempMin: 0, tempMax: 0, temp: 0 } })), 'ice') // осадки по precip
  assert.equal(rule(day({ lunch: { symbols: ['cloudy'], precip: 0.09, tempMin: 0, tempMax: 0, temp: 0 } })), 'cloudy')
  assert.equal(rule(day({ lunch: { symbols: ['snow'], precip: 1, tempMin: 0, tempMax: 0, temp: 0 } })), 'ice') // ice важнее rain/snow
})

test('adviceFor: freeze', () => {
  const rainy = { symbols: ['rain'], precip: 2, temp: 3, tempMin: 3, tempMax: 4 }
  const dryFrost = { symbols: ['cloudy'], precip: 0, temp: -1, tempMin: -1, tempMax: -1 }
  assert.deepEqual(adviceFor(day({ lunch: rainy, evening: dryFrost })), { rule: 'freeze', when: 'evening', t: null })
  // дождь в прошедшем окне не участвует
  assert.notEqual(rule(ORDER.map((id) => (id === 'noon' ? mk(id, { ...rainy, past: true }) : id === 'evening' ? mk(id, dryFrost) : { ...mk(id), past: true }))), 'freeze')
  // сухое окно ДО мокрого — не freeze
  assert.notEqual(rule(day({ lunch: dryFrost, evening: rainy })), 'freeze')
  // сухое окно с температурой выше нуля — не freeze
  assert.notEqual(rule(day({ lunch: rainy, evening: { ...dryFrost, tempMin: 1, tempMax: 1, temp: 1 } })), 'freeze')
})

test('adviceFor: снег, мокрый снег, ливень, дождь', () => {
  const cold = { temp: -5, tempMin: -5, tempMax: -5 }
  assert.equal(rule(day({ lunch: { ...cold, symbols: ['heavysnow'], precip: 3 } })), 'heavySnow')
  assert.equal(rule(day({ lunch: { ...cold, symbols: ['lightsleet'], precip: 1 } })), 'sleet')
  assert.equal(rule(day({ lunch: { ...cold, symbols: ['lightsnow'], precip: 1 } })), 'snow')
  assert.equal(rule(day({ lunch: { ...cold, symbols: ['rain', 'snow'], precip: 1 } })), 'snow')
  assert.equal(rule(day({ lunch: { symbols: ['heavyrain'], precip: 5 } })), 'heavyRain')
  assert.equal(rule(day({ lunch: { symbols: ['heavyrainshowers_night'], precip: 5 } })), 'heavyRain')
  assert.equal(rule(day({ lunch: { symbols: ['heavyrainandthunder'], precip: 5 } })), 'thunder')
  assert.equal(rule(day({ lunch: { symbols: ['lightrain'], precip: 0.5 } })), 'rain')
})

test('adviceFor: rain по precip — граница 0.3', () => {
  assert.equal(RAIN_MM, 0.3)
  assert.equal(rule(day({ lunch: { symbols: ['cloudy'], precip: 0.29 } })), 'cloudy')
  assert.equal(rule(day({ lunch: { symbols: ['cloudy'], precip: 0.3 } })), 'rain')
})

test('adviceFor: wind — граница 10 м/с', () => {
  assert.equal(WIND_MS, 10)
  assert.equal(rule(day({ lunch: { wind: 9.9 } })), 'cloudy')
  assert.equal(rule(day({ lunch: { wind: 10 } })), 'wind')
  assert.equal(rule(day({ lunch: { wind: null } })), 'cloudy')
})

test('adviceFor: frost и heat — границы и подстановка температуры', () => {
  assert.equal(FROST_C, -10)
  assert.equal(HEAT_C, 33)
  assert.deepEqual(adviceFor(day({ lunch: { temp: -9, tempMin: -9, tempMax: -9 }, evening: { temp: -10, tempMin: -10, tempMax: -8 } })), {
    rule: 'frost',
    when: null,
    t: '−10°',
  })
  assert.equal(rule(day({ lunch: { temp: -9, tempMin: -9, tempMax: -9 } })), 'cloudy')
  assert.deepEqual(adviceFor(day({ lunch: { temp: 30, tempMin: 29, tempMax: 33 } })), { rule: 'heat', when: null, t: '+33°' })
  assert.equal(rule(day({ lunch: { temp: 30, tempMin: 29, tempMax: 32 } })), 'cloudy')
  // жара/мороз только по оставшимся окнам
  assert.equal(rule(day({ noon: { past: true, tempMin: 40, tempMax: 40, temp: 40 }, lunch: {} })), 'cloudy')
})

test('adviceFor: fog, clear, cloudy', () => {
  assert.equal(rule(day({ lunch: { symbols: ['fog'] } })), 'fog')
  assert.equal(rule(day({ lunch: { symbols: ['clearsky'] }, evening: { symbols: ['fair'] } })), 'clear')
  assert.equal(rule(day({ lunch: { symbols: ['clearsky'] }, evening: { symbols: ['cloudy'] } })), 'cloudy')
  assert.equal(rule(day({ lunch: { symbols: [] } })), 'cloudy') // вида нет — не «ясно»
})

test('adviceFor: when — одно окно, весь день, одно оставшееся', () => {
  const rainy = { symbols: ['rain'], precip: 2, temp: 8, tempMin: 8, tempMax: 9 }
  assert.deepEqual(adviceFor(day({ lunch: rainy, evening: {} })), { rule: 'rain', when: 'lunch', t: null })
  assert.deepEqual(adviceFor(day({ lunch: rainy, evening: rainy })), { rule: 'rain', when: 'allDay', t: null })
  assert.deepEqual(adviceFor(day({ noon: rainy, lunch: rainy, evening: rainy })), { rule: 'rain', when: 'allDay', t: null })
  assert.deepEqual(adviceFor(day({ evening: rainy })), { rule: 'rain', when: 'evening', t: null }) // оставшееся окно одно
})

test('hashString: FNV-1a 32 бита', () => {
  assert.equal(hashString(''), 2166136261)
  assert.equal(hashString('a'), 3826002220)
  assert.equal(hashString('foobar'), 3214735720)
})

test('adviceText: стабилен и использует все варианты правила', () => {
  const advice = { rule: 'late', when: null, t: null }
  const a = adviceText(advice, { date: '2026-10-29', cityId: 'yerevan' })
  assert.equal(adviceText(advice, { date: '2026-10-29', cityId: 'yerevan' }), a)
  const seen = new Set()
  for (let i = 0; i < 60; i += 1) {
    const date = `2026-11-${String((i % 30) + 1).padStart(2, '0')}`
    seen.add(adviceText(advice, { date: i < 30 ? date : date.replace('-11-', '-12-'), cityId: 'yerevan' }))
  }
  assert.equal(seen.size, s.advice.late.length)
})

test('adviceText: подставляет when и t', () => {
  const text = adviceText({ rule: 'rain', when: 'lunch', t: null }, { date: '2026-10-29', cityId: 'moscow' })
  assert.ok(text.includes('в обед'))
  const frost = adviceText({ rule: 'frost', when: null, t: '−12°' }, { date: '2026-10-29', cityId: 'moscow' })
  assert.ok(frost.includes('−12°'))
})

test('строки: у каждого правила достаточно вариантов, без undefined и лишних ключей', () => {
  const rules = ['thunder', 'ice', 'freeze', 'heavySnow', 'sleet', 'snow', 'heavyRain', 'rain', 'wind', 'frost', 'heat', 'fog', 'clear', 'cloudy', 'late']
  assert.deepEqual(Object.keys(s.advice).sort(), [...rules].sort())
  for (const r of rules) {
    assert.ok(s.advice[r].length >= MIN_VARIANTS, r)
    for (const fn of s.advice[r]) {
      for (const when of Object.values(s.adviceWhen)) {
        const text = fn({ when, t: formatTemp(-12) })
        assert.ok(typeof text === 'string' && text.length > 0 && !text.includes('undefined'), `${r}: ${text}`)
      }
    }
  }
})
