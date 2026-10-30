import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canReadHolidays,
  dayType,
  formatPeriod,
  formatRange,
  groupRanges,
  indexDays,
  isHolidaysEditor,
  isRest,
  isWeekend,
  monthGrid,
  restPeriods,
  todayIn,
  validateRange,
} from './holidays.js'
import strings from '../strings.js'

const NY = 'Новогодние каникулы'
const row = (country, date, kind, name = null) => ({ country, date, kind, name })
const mapOf = (...rows) => new Map(rows.map((r) => [r.date, r]))
const range = (country, start, end, kind, name) => {
  const out = []
  for (let d = Number(start.slice(8)); d <= Number(end.slice(8)); d += 1) out.push(row(country, `${start.slice(0, 8)}${String(d).padStart(2, '0')}`, kind, name))
  return out
}

test('isWeekend: сб и вс', () => {
  assert.equal(isWeekend('2026-01-03'), true) // суббота
  assert.equal(isWeekend('2026-01-04'), true) // воскресенье
  assert.equal(isWeekend('2026-01-05'), false) // понедельник
  assert.equal(isWeekend('2026-01-02'), false) // пятница
})

test('dayType: все виды и день без строки', () => {
  assert.equal(dayType('2026-01-01', row('RU', '2026-01-01', 'holiday', NY)), 'holiday')
  assert.equal(dayType('2026-01-03', row('RU', '2026-01-03', 'holiday', NY)), 'holiday') // праздник на субботу
  assert.equal(dayType('2026-01-09', row('RU', '2026-01-09', 'day_off')), 'day_off')
  assert.equal(dayType('2026-01-10', row('RU', '2026-01-10', 'workday')), 'workday')
  assert.equal(dayType('2026-01-09', row('RU', '2026-01-09', 'short')), 'short')
  assert.equal(dayType('2026-01-10'), 'weekend')
  assert.equal(dayType('2026-01-12'), 'work')
})

test('isRest: нерабочие — holiday, day_off, weekend', () => {
  assert.deepEqual(['holiday', 'day_off', 'weekend', 'workday', 'short', 'work'].map(isRest), [true, true, true, false, false, false])
})

test('indexDays: по странам, чужие коды игнорируются', () => {
  const index = indexDays([row('RU', '2026-01-01', 'holiday', NY), row('AM', '2026-01-01', 'holiday', 'Новый год'), row('US', '2026-01-01', 'holiday', 'x')])
  assert.equal(index.RU.get('2026-01-01').name, NY)
  assert.equal(index.AM.get('2026-01-01').name, 'Новый год')
  assert.deepEqual(Object.keys(index), ['AM', 'RU'])
  assert.equal(indexDays(null).RU.size, 0)
})

test('права: читатель view/run, редактор — ответственный или admin', () => {
  assert.equal(canReadHolidays({ module_access: { holidays: 'view' } }), true)
  assert.equal(canReadHolidays({ module_access: { holidays: 'structure' } }), false)
  assert.equal(canReadHolidays(null), false)
  assert.equal(isHolidaysEditor({ module_responsible: { holidays: true } }), true)
  assert.equal(isHolidaysEditor({ can_manage_users: true }), true)
  assert.equal(isHolidaysEditor({ module_responsible: { news: true } }), false)
  assert.equal(isHolidaysEditor(undefined), false)
})

test('restPeriods: новогодний отрезок склеивается с day_off и сб/вс, через границу года', () => {
  const rows = mapOf(...range('RU', '2026-01-01', '2026-01-08', 'holiday', NY), row('RU', '2026-01-09', 'day_off'))
  assert.deepEqual(restPeriods(rows, '2025-12-29'), [{ start: '2026-01-01', end: '2026-01-11', days: 11, names: [NY], now: false }])
})

test('restPeriods: рабочая суббота (workday, short) разрывает отрезок', () => {
  // 01.05.2026 — пятница; суббота 02.05 рабочая, воскресенье 03.05 — отдельный обычный выходной (не выводится)
  const rows = mapOf(row('RU', '2026-05-01', 'holiday', 'Праздник Весны и Труда'), row('RU', '2026-05-02', 'workday'))
  assert.deepEqual(restPeriods(rows, '2026-04-27'), [{ start: '2026-05-01', end: '2026-05-01', days: 1, names: ['Праздник Весны и Труда'], now: false }])
  const short = mapOf(row('RU', '2026-05-01', 'holiday', 'Праздник Весны и Труда'), row('RU', '2026-05-02', 'short'))
  assert.equal(restPeriods(short, '2026-04-27')[0].end, '2026-05-01')
})

test('restPeriods: обычные выходные без праздника не выводятся; пустые данные — []', () => {
  assert.deepEqual(restPeriods(new Map(), '2026-01-05'), [])
  assert.deepEqual(restPeriods(mapOf(row('RU', '2026-01-12', 'workday')), '2026-01-05'), [])
})

test('restPeriods: «сегодня» внутри отрезка — начало = сегодня, now: true', () => {
  const rows = mapOf(row('RU', '2026-01-01', 'holiday', NY), row('RU', '2026-01-02', 'holiday', NY))
  assert.deepEqual(restPeriods(rows, '2026-01-02'), [{ start: '2026-01-02', end: '2026-01-04', days: 3, names: [NY], now: true }])
})

test('restPeriods: уникальные названия по порядку дат', () => {
  const rows = mapOf(row('RU', '2026-01-01', 'holiday', 'A'), row('RU', '2026-01-02', 'holiday', 'B'), row('RU', '2026-01-03', 'holiday', 'A'), row('RU', '2026-01-04', 'day_off'))
  assert.deepEqual(restPeriods(rows, '2025-12-31')[0].names, ['A', 'B'])
})

test('restPeriods: limit и horizon', () => {
  const rows = mapOf(...['07', '14', '21', '28'].map((d) => row('RU', `2026-01-${d}`, 'holiday', `H${d}`)))
  assert.equal(restPeriods(rows, '2026-01-05').length, 3)
  assert.equal(restPeriods(rows, '2026-01-05', { limit: 1 }).length, 1)
  assert.equal(restPeriods(rows, '2026-01-05', { limit: 10 }).length, 4)
  assert.deepEqual(restPeriods(rows, '2026-01-05', { horizon: 3 }).map((p) => p.start), ['2026-01-07'])
})

test('monthGrid: понедельник первый, недели по 7 ячеек', () => {
  const jan = monthGrid(2026, 1) // 1 января 2026 — четверг
  assert.deepEqual(jan[0].map((c) => c?.iso ?? null), [null, null, null, '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'])
  assert.ok(jan.every((week) => week.length === 7))
  assert.equal(jan.flat().filter(Boolean).length, 31)
})

test('monthGrid: февраль високосного года и месяц, начинающийся в воскресенье', () => {
  assert.equal(monthGrid(2028, 2).flat().filter(Boolean).length, 29)
  assert.equal(monthGrid(2027, 2).flat().filter(Boolean).length, 28)
  const feb = monthGrid(2026, 2) // 1 февраля 2026 — воскресенье
  assert.deepEqual(feb[0].map((c) => c?.iso ?? null), [null, null, null, null, null, null, '2026-02-01'])
  assert.equal(feb.length, 5)
})

test('todayIn: часовой пояс страны около полуночи', () => {
  const tz = { AM: 'Asia/Yerevan', RU: 'Europe/Moscow' }
  const before = new Date('2026-12-31T20:30:00Z')
  assert.equal(todayIn(tz.RU, before), '2026-12-31')
  assert.equal(todayIn(tz.AM, before), '2027-01-01')
  const after = new Date('2026-12-31T21:30:00Z')
  assert.equal(todayIn(tz.RU, after), '2027-01-01')
  assert.equal(todayIn(tz.AM, after), '2027-01-01')
})

test('groupRanges: склеивает подряд идущие дни с одинаковыми kind и name', () => {
  const rows = [
    ...range('AM', '2027-01-01', '2027-01-02', 'holiday', 'Новый год'),
    ...range('RU', '2027-01-01', '2027-01-03', 'holiday', NY),
    row('RU', '2027-01-04', 'holiday', 'Другое'),
    row('RU', '2027-01-05', 'day_off'),
    row('RU', '2027-01-06', 'day_off'),
    row('RU', '2027-01-08', 'day_off'),
  ]
  assert.deepEqual(groupRanges(rows), [
    { country: 'AM', start: '2027-01-01', end: '2027-01-02', kind: 'holiday', name: 'Новый год' },
    { country: 'RU', start: '2027-01-01', end: '2027-01-03', kind: 'holiday', name: NY },
    { country: 'RU', start: '2027-01-04', end: '2027-01-04', kind: 'holiday', name: 'Другое' },
    { country: 'RU', start: '2027-01-05', end: '2027-01-06', kind: 'day_off', name: null },
    { country: 'RU', start: '2027-01-08', end: '2027-01-08', kind: 'day_off', name: null },
  ])
  assert.deepEqual(groupRanges([]), [])
})

test('formatPeriod и formatRange', () => {
  assert.equal(formatPeriod('2026-01-01', '2026-01-11'), '1–11 янв')
  assert.equal(formatPeriod('2025-12-31', '2026-01-11'), '31 дек – 11 янв')
  assert.equal(formatPeriod('2026-05-09', '2026-05-09'), '9 мая')
  assert.equal(formatRange('2027-01-01', '2027-01-08'), '01.01–08.01')
  assert.equal(formatRange('2027-03-08', '2027-03-08'), '08.03')
})

test('validateRange: те же правила, что на сервере', () => {
  const e = strings.errors
  const ok = { start: '2027-01-01', end: '2027-01-08', kind: 'holiday', name: NY }
  assert.equal(validateRange(ok), null)
  assert.equal(validateRange({ ...ok, start: undefined }), e.datesRequired)
  assert.equal(validateRange({ ...ok, start: '2027-01-08', end: '2027-01-01' }), e.rangeOrder)
  assert.equal(validateRange({ ...ok, end: '2027-02-01' }), e.rangeTooLong) // 32 дня
  assert.equal(validateRange({ ...ok, end: '2027-01-31' }), null) // 31 день
  assert.equal(validateRange({ ...ok, start: '1999-12-30', end: '1999-12-31' }), e.datesOutOfRange)
  assert.equal(validateRange({ ...ok, end: '2101-01-01', start: '2100-12-31' }), e.datesOutOfRange)
  assert.equal(validateRange({ ...ok, name: null }), e.nameRequired)
  assert.equal(validateRange({ ...ok, name: '   ' }), e.nameRequired)
  assert.equal(validateRange({ ...ok, kind: 'day_off', name: null }), null)
  assert.equal(validateRange({ start: '2027-01-02', end: '2027-01-03', kind: 'workday', name: null }), null) // сб и вс
  const bad = validateRange({ start: '2027-01-01', end: '2027-01-08', kind: 'workday', name: null })
  assert.ok(bad.startsWith(e.workdayWeekend))
  assert.ok(bad.includes('01.01.2027') && bad.includes('07.01.2027') && !bad.includes('08.01.2027')) // не больше 5 дат
})
