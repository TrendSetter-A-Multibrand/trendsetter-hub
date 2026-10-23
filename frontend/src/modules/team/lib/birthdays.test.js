import test from 'node:test'
import assert from 'node:assert/strict'
import { dayByPerson, monthKey, upcomingBirthdays } from './birthdays.js'

const b = (personId, name, day) => ({ personId, name, directionId: 'ops', day, month: 0 })

test('monthKey и dayByPerson', () => {
  assert.equal(monthKey('2026-10-23'), '2026-10')
  assert.deepEqual(dayByPerson([b(1, 'А', 5), b(2, 'Б', 9)]), { 1: 5, 2: 9 })
  assert.deepEqual(dayByPerson(null), {})
})

test('ближайшие: окно включает сегодня и +7 дней, сортировка по дате и имени', () => {
  const entries = [{ month: '2026-10', items: [b(1, 'Яков', 22), b(2, 'Борис', 23), b(3, 'Анна', 23), b(4, 'Вера', 30), b(5, 'Глеб', 31)] }]
  const list = upcomingBirthdays(entries, '2026-10-23')
  assert.deepEqual(list.map((x) => [x.name, x.date, x.inDays]), [['Анна', '2026-10-23', 0], ['Борис', '2026-10-23', 0], ['Вера', '2026-10-30', 7]])
})

test('ближайшие: окно пересекает границу месяца и года, дубли убираются', () => {
  const entries = [
    { month: '2026-12', items: [b(1, 'Анна', 30)] },
    { month: '2027-01', items: [b(2, 'Борис', 2), b(3, 'Вера', 20)] },
    { month: '2026-12', items: [b(1, 'Анна', 30)] },
  ]
  const list = upcomingBirthdays(entries, '2026-12-29')
  assert.deepEqual(list.map((x) => [x.name, x.date, x.inDays]), [['Анна', '2026-12-30', 1], ['Борис', '2027-01-02', 4]])
})

test('ближайшие: пусто и невалидная дата (30 февраля) не падают', () => {
  assert.deepEqual(upcomingBirthdays([], '2026-10-23'), [])
  assert.deepEqual(upcomingBirthdays([{ month: '2026-02', items: [b(1, 'А', 30)] }], '2026-02-25'), [])
})
