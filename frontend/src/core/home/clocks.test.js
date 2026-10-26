import test from 'node:test'
import assert from 'node:assert/strict'
import { CLOCK_ZONES, formatClock, msUntilNextMinute } from './clocks.js'

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
