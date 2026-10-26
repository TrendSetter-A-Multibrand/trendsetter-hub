import test from 'node:test'
import assert from 'node:assert/strict'
import { awayMap, homeLeave, monthDays, monthEnd, monthStart, segmentsOf, shiftMonth, weekday } from './leave.js'

test('границы месяца и сдвиг', () => {
  assert.equal(monthStart('2026-10-23'), '2026-10-01')
  assert.equal(monthEnd('2026-10-01'), '2026-10-31')
  assert.equal(monthEnd('2024-02-01'), '2024-02-29')
  assert.equal(shiftMonth('2026-12-01', 1), '2027-01-01')
  assert.equal(shiftMonth('2026-01-01', -1), '2025-12-01')
})

test('monthDays: число дней и выходные', () => {
  const days = monthDays('2026-10-01')
  assert.equal(days.length, 31)
  assert.equal(weekday('2026-10-01'), 4) // четверг
  assert.deepEqual(days.filter((d) => d.weekend).map((d) => d.day), [3, 4, 10, 11, 17, 18, 24, 25, 31])
})

test('segmentsOf: обрезка по месяцу и фильтр по человеку', () => {
  const leaves = [
    { personId: 1, kind: 'annual', start: '2026-09-28', end: '2026-10-03' },
    { personId: 1, kind: 'study', start: '2026-10-28', end: '2026-11-05' },
    { personId: 1, kind: 'other', start: '2026-11-10', end: '2026-11-12' },
    { personId: 2, kind: 'annual', start: '2026-10-10', end: '2026-10-12' },
  ]
  assert.deepEqual(segmentsOf(leaves, 1, '2026-10-01'), [
    { kind: 'annual', start: '2026-09-28', end: '2026-10-03', col: 1, span: 3 },
    { kind: 'study', start: '2026-10-28', end: '2026-11-05', col: 28, span: 4 },
  ])
  assert.equal(segmentsOf(leaves, 3, '2026-10-01').length, 0)
})

test('awayMap: только отпуска, покрывающие сегодня', () => {
  const leaves = [
    { personId: 1, kind: 'annual', start: '2026-10-20', end: '2026-10-25' },
    { personId: 1, kind: 'other', start: '2026-10-23', end: '2026-10-30' },
    { personId: 2, kind: 'annual', start: '2026-10-24', end: '2026-10-26' },
  ]
  assert.deepEqual(awayMap(leaves, '2026-10-23'), { 1: { end: '2026-10-30' } })
  assert.deepEqual(awayMap(null, '2026-10-23'), {})
})

test('homeLeave: в отпуске сегодня — максимальный end, сортировка по end и имени, без kind', () => {
  const items = [
    { personId: 1, name: 'Борис', kind: 'annual', start: '2026-10-20', end: '2026-10-25' },
    { personId: 1, name: 'Борис', kind: 'other', start: '2026-10-23', end: '2026-10-30' },
    { personId: 2, name: 'Анна', kind: 'study', start: '2026-10-23', end: '2026-10-30' },
    { personId: 3, name: 'Вера', kind: 'annual', start: '2026-10-22', end: '2026-10-24' },
    { personId: 4, name: 'Глеб', kind: 'annual', start: '2026-10-10', end: '2026-10-22' },
  ]
  const { away } = homeLeave(items, '2026-10-23')
  assert.deepEqual(away, [
    { personId: 3, name: 'Вера', end: '2026-10-24' },
    { personId: 2, name: 'Анна', end: '2026-10-30' },
    { personId: 1, name: 'Борис', end: '2026-10-30' },
  ])
  assert.ok(away.every((a) => !('kind' in a)))
})

test('homeLeave: граница today + 14 включительно, начавшийся вчера — в away, а не в upcoming', () => {
  const items = [
    { personId: 1, name: 'Анна', kind: 'annual', start: '2026-11-06', end: '2026-11-10' }, // today + 14
    { personId: 2, name: 'Борис', kind: 'annual', start: '2026-11-07', end: '2026-11-10' }, // today + 15
    { personId: 3, name: 'Вера', kind: 'annual', start: '2026-10-22', end: '2026-10-28' }, // начался вчера
    { personId: 4, name: 'Глеб', kind: 'annual', start: '2026-10-23', end: '2026-10-25' }, // сегодня — это away
    { personId: 5, name: 'Дина', kind: 'sick', start: '2026-10-25', end: '2026-10-26' },
    { personId: 5, name: 'Дина', kind: 'annual', start: '2026-10-25', end: '2026-10-29' }, // дубль того же start
  ]
  const { away, upcoming } = homeLeave(items, '2026-10-23')
  assert.deepEqual(away.map((a) => a.personId), [4, 3])
  assert.deepEqual(upcoming, [
    { personId: 5, name: 'Дина', start: '2026-10-25', end: '2026-10-29' },
    { personId: 1, name: 'Анна', start: '2026-11-06', end: '2026-11-10' },
  ])
  assert.ok(upcoming.every((u) => !('kind' in u)))
  assert.deepEqual(homeLeave(null, '2026-10-23'), { away: [], upcoming: [] })
})
