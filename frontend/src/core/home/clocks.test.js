import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CLOCK_KEYS,
  CLOCK_ZONES,
  allZones,
  browserZone,
  formatClock,
  isValidZone,
  loadClockZone,
  msUntilNextMinute,
  saveClockZone,
  zoneLabel,
  zoneOffset,
} from './clocks.js'

const time = (iso) => Object.fromEntries(CLOCK_ZONES.map((z) => [z.id, formatClock(new Date(iso), z.timeZone)]))

test('зимой: Ереван +4, Москва +3, Париж +1, Нью-Йорк -5', () => {
  assert.deepEqual(time('2026-01-15T12:00:00Z'), { yerevan: '16:00', moscow: '15:00', paris: '13:00', newYork: '07:00' })
})

test('летом: сдвиг DST у Парижа (+2) и Нью-Йорка (-4), Ереван и Москва без сдвига', () => {
  assert.deepEqual(time('2026-07-15T12:00:00Z'), { yerevan: '16:00', moscow: '15:00', paris: '14:00', newYork: '08:00' })
})

test('полночь отображается как 00:xx (h23)', () => {
  assert.equal(formatClock(new Date('2026-01-15T21:05:00Z'), 'Asia/Yerevan'), '01:05')
  assert.equal(formatClock(new Date('2026-01-15T20:05:00Z'), 'Asia/Yerevan'), '00:05')
})

test('msUntilNextMinute: до границы минуты', () => {
  assert.equal(msUntilNextMinute(Date.UTC(2026, 0, 1, 0, 0, 0)), 60000)
  assert.equal(msUntilNextMinute(Date.UTC(2026, 0, 1, 0, 0, 45, 500)), 14500)
})

test('isValidZone: по try/catch, а не по списку', () => {
  for (const z of ['Europe/Moscow', 'UTC', 'Etc/UTC']) assert.equal(isValidZone(z), true, z)
  for (const z of ['', 'Mars/Base', null, undefined, 5]) assert.equal(isValidZone(z), false, String(z))
})

test('browserZone: валидная, невалидная, исключение', () => {
  const fake = (tz) => ({ DateTimeFormat: function () { return { resolvedOptions: () => ({ timeZone: tz }) } } })
  assert.equal(browserZone(fake('Asia/Tokyo')), 'Asia/Tokyo')
  assert.equal(browserZone(fake('Mars/Base')), null)
  assert.equal(browserZone(fake(undefined)), null)
  assert.equal(browserZone({ DateTimeFormat: function () { throw new Error('x') } }), null)
})

test('allZones: без supportedValuesOf — словарь + extra без дублей; с ним — список + extra', () => {
  const names = { 'Asia/Yerevan': 'Ереван', 'Europe/Moscow': 'Москва' }
  assert.deepEqual(allZones(['Europe/Moscow', 'Asia/Tokyo'], {}, names), ['Asia/Yerevan', 'Europe/Moscow', 'Asia/Tokyo'])
  const intl = { supportedValuesOf: () => ['Europe/Paris', 'Asia/Tokyo'] }
  assert.deepEqual(allZones(['Asia/Tokyo', 'UTC'], intl, names), ['Europe/Paris', 'Asia/Tokyo', 'UTC'])
})

test('zoneLabel: словарь или последний сегмент IANA', () => {
  assert.equal(zoneLabel('Asia/Yerevan', { 'Asia/Yerevan': 'Ереван' }), 'Ереван')
  assert.equal(zoneLabel('America/Sao_Paulo', {}), 'Sao Paulo')
})

test('zoneOffset: GMT+4 для Еревана', () => {
  assert.equal(zoneOffset('Asia/Yerevan', new Date('2026-01-15T12:00:00Z')), 'GMT+4')
})

test('loadClockZone / saveClockZone', () => {
  const data = {}
  const st = { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v) } }
  assert.equal(loadClockZone(st, 0), null)
  saveClockZone(st, 1, 'Asia/Tokyo')
  assert.equal(data[CLOCK_KEYS[1]], 'Asia/Tokyo')
  assert.equal(loadClockZone(st, 1), 'Asia/Tokyo')
  data[CLOCK_KEYS[0]] = 'мусор'
  assert.equal(loadClockZone(st, 0), null)
  assert.equal(loadClockZone({ getItem: () => { throw new Error('denied') } }, 0), null)
  assert.doesNotThrow(() => saveClockZone({ setItem: () => { throw new Error('denied') } }, 0, 'Asia/Tokyo'))
})
