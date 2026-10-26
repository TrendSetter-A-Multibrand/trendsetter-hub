import test from 'node:test'
import assert from 'node:assert/strict'
import { dayLabel, formatTemp, weatherKind } from './weather.js'

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
