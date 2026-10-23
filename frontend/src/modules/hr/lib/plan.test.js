import test from 'node:test'
import assert from 'node:assert/strict'
import { barPosition, monthColumns, monthLoad, OVERLOAD_THRESHOLD, planRows } from './plan.js'

const dirs = [{ id: 'buy', shortName: 'Закупки' }, { id: 'ops', shortName: 'Операции' }, { id: 'empty', shortName: 'Пусто' }]
const people = [
  { id: 1, name: 'Иванов Иван', directionId: 'buy', isArchived: false },
  { id: 2, name: 'Петров Пётр', directionId: 'buy', isArchived: false },
  { id: 3, name: 'Сидоров Сидор', directionId: 'buy', isArchived: false },
  { id: 4, name: 'Уволен Давно', directionId: 'buy', isArchived: true },
  { id: 5, name: 'Орлов Олег', directionId: 'ops', isArchived: false },
]
const plan = (personId, start, end) => ({ id: personId * 10, personId, start, end, comment: null, status: 'planned' })

test('barPosition: доли года и обрезка по границам', () => {
  const full = barPosition('2026-01-01', '2026-12-31', 2026)
  assert.equal(full.left, 0)
  assert.equal(full.width, 100)
  const jan = barPosition('2026-01-01', '2026-01-31', 2026)
  assert.equal(jan.left, 0)
  assert.ok(Math.abs(jan.width - (31 / 365) * 100) < 1e-9)
  const clipped = barPosition('2025-12-20', '2026-01-10', 2026)
  assert.equal(clipped.left, 0)
  assert.ok(Math.abs(clipped.width - (10 / 365) * 100) < 1e-9)
  assert.equal(barPosition('2025-05-01', '2025-05-10', 2026), null)
  assert.equal(barPosition('2027-01-01', '2027-01-10', 2026), null)
})

test('monthColumns: 12 подряд идущих месяцев на всю ширину', () => {
  const cols = monthColumns(2028) // високосный
  assert.equal(cols.length, 12)
  assert.equal(cols[0].left, 0)
  assert.ok(Math.abs(cols[11].left + cols[11].width - 100) < 1e-9)
  cols.slice(1).forEach((c, i) => assert.ok(Math.abs(c.left - (cols[i].left + cols[i].width)) < 1e-9))
})

test('monthLoad: доля людей с планом от размера направления, архивные не считаются, подсветка по порогу', () => {
  assert.equal(OVERLOAD_THRESHOLD, 0.3)
  const plans = [plan(1, '2026-12-05', '2026-12-20'), plan(2, '2026-12-28', '2027-01-05'), plan(5, '2026-03-01', '2026-03-02'), plan(4, '2026-12-01', '2026-12-02')]
  const rows = monthLoad(plans, people, dirs, 2026)
  assert.deepEqual(rows.map((r) => [r.direction.id, r.size]), [['buy', 3], ['ops', 1]]) // «Пусто» без людей опущено
  const buy = rows[0].months
  assert.deepEqual([buy[11].count, buy[11].over], [2, true]) // декабрь: 2 из 3
  assert.equal(Math.round(buy[11].ratio * 100), 67)
  assert.deepEqual([buy[0].count, buy[0].over], [0, false]) // январь 2026: план Петрова с 2026-12-28 до 2027 — в 2026 только декабрь
  assert.equal(rows[1].months[2].over, true) // 1 из 1
  // ровно на пороге (3 из 10 = 30%) — перегруз; 2 из 10 — нет
  const ten = Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, name: `Р${i}`, directionId: 'buy', isArchived: false }))
  const mk = (n) => monthLoad(ten.slice(0, n).map((p) => plan(p.id, '2026-06-10', '2026-06-12')), ten, dirs, 2026)[0].months[5]
  assert.equal(mk(3).over, true)
  assert.equal(mk(2).over, false)
})

test('monthLoad: человек с двумя периодами в месяце считается один раз', () => {
  const rows = monthLoad([plan(1, '2026-06-01', '2026-06-03'), { ...plan(1, '2026-06-20', '2026-06-22'), id: 99 }], people, dirs, 2026)
  assert.equal(rows[0].months[5].count, 1)
})

test('planRows: направления, поиск по имени, архивные скрыты, планы по человеку отсортированы', () => {
  const plans = [plan(1, '2026-08-01', '2026-08-02'), { ...plan(1, '2026-02-01', '2026-02-02'), id: 5 }]
  const all = planRows(plans, people, dirs)
  assert.deepEqual(all.map((g) => g.direction.id), ['buy', 'ops'])
  assert.deepEqual(all[0].rows.map((r) => r.person.id), [1, 2, 3])
  assert.deepEqual(all[0].rows[0].plans.map((p) => p.start), ['2026-02-01', '2026-08-01'])
  assert.deepEqual(planRows(plans, people, dirs, { directionId: 'ops' }).map((g) => g.direction.id), ['ops'])
  assert.deepEqual(planRows(plans, people, dirs, { query: ' пётр ' })[0].rows.map((r) => r.person.id), [2])
  assert.deepEqual(planRows(plans, people, dirs, { query: 'нет такого' }), [])
})
