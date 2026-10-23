import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildIndex,
  buildRows,
  cardState,
  chainOf,
  collapseLeaders,
  findMatches,
  forceOpenSet,
  parseId,
  pathSet,
  rootsOnPath,
} from './tree.js'

const directions = [
  { id: 'leadership', label: 'РУКОВОДСТВО', shortName: 'Руководство', color: '#A22325', avatarInk: '#FFFFFF' },
  { id: 'ops', label: 'ОПЕРАЦИИ', shortName: 'Операции', color: '#1D428A', avatarInk: '#FFFFFF' },
  { id: 'buy', label: 'ЗАКУПКИ', shortName: 'Закупки', color: '#F3D03E', avatarInk: '#252120' },
  { id: 'empty', label: 'ПУСТО', shortName: 'Пусто', color: '#B3ACA9', avatarInk: '#252120' },
]

const person = (id, name, managerId, directionId, extra = {}) => ({ id, name, title: `Должность ${id}`, managerId, directionId, ...extra })

//  1 CEO ── 2 ассистент
//        ├─ 3 ops ── 4 ── 6
//        │         └─ 5
//        └─ 7 buy ── 8
const people = [
  person(1, 'Иванов Иван', null, 'leadership', { isCeo: true }),
  person(2, 'Петрова Анна', 1, 'leadership', { isAssistant: true }),
  person(3, 'Сидоров Павел', 1, 'ops', { tag: 'СТМ' }),
  person(4, 'Орлов Олег', 3, 'ops', { hobbies: ['Шахматы'] }),
  person(5, 'Громова Мария', 3, 'ops', { location: 'Ереван' }),
  person(6, 'Лебедев Лев', 4, 'ops'),
  person(7, 'Крылова Вера', 1, 'buy'),
  person(8, 'Жуков Дмитрий', 7, 'buy'),
]

test('индекс: дети, total, CEO, ассистент, корни направлений', () => {
  const idx = buildIndex(people, directions)
  assert.equal(idx.ceoId, 1)
  assert.deepEqual(idx.assistantIds, [2])
  assert.deepEqual(idx.by[3].kids, [4, 5])
  assert.equal(idx.by[3].total, 3)
  assert.equal(idx.by[1].total, 7)
  assert.equal(idx.ceoReports, 2)
  assert.equal(idx.by[3].initials, 'СП')
  assert.deepEqual(
    idx.dirs.map((d) => [d.id, d.roots, d.count]),
    [['ops', [3], 4], ['buy', [7], 2]],
  )
})

test('аватары: CEO красный, ассистент серый, остальные по направлению', () => {
  const { by } = buildIndex(people, directions)
  assert.equal(by[1].av.bg, '#A22325')
  assert.equal(by[2].av.bg, '#E9E4E1')
  assert.deepEqual(by[7].av, { bg: '#F3D03E', ink: '#252120' })
})

test('сирота (руководителя нет в списке) становится корнем своего направления, без падения', () => {
  const idx = buildIndex(people.filter((p) => p.id !== 3), directions)
  assert.equal(idx.by[4].mgr, null)
  assert.deepEqual(idx.dirs.find((d) => d.id === 'ops').roots, [4, 5])
})

test('руководитель в другом направлении: человек — корень своего направления', () => {
  const idx = buildIndex([...people, person(9, 'Тестов Тест', 3, 'buy')], directions)
  assert.deepEqual(idx.dirs.find((d) => d.id === 'buy').roots, [7, 9])
  assert.equal(idx.by[3].total, 4)
})

test('пустая карта и отсутствие CEO не падают', () => {
  const empty = buildIndex([], directions)
  assert.equal(empty.ceoId, null)
  assert.deepEqual(empty.dirs, [])
  const noCeo = buildIndex(people.filter((p) => !p.isCeo), directions)
  assert.equal(noCeo.ceoId, null)
  assert.equal(noCeo.ceoReports, 0)
})

test('цикл в данных игнорируется (защита от зависания)', () => {
  const idx = buildIndex([person(1, 'А Б', 2, 'ops'), person(2, 'В Г', 1, 'ops')], directions)
  assert.ok(idx.by[1].mgr === null || idx.by[2].mgr === null)
})

test('parseId: строка из URL приводится к числу, чужие значения отбрасываются', () => {
  const { by } = buildIndex(people, directions)
  assert.equal(parseId('4', by), 4)
  assert.equal(parseId('999', by), null)
  assert.equal(parseId('abc', by), null)
  assert.equal(parseId(null, by), null)
})

test('pathSet и chainOf: числовые id, от выбранного до CEO', () => {
  const { by } = buildIndex(people, directions)
  assert.deepEqual([...pathSet(by, 6)].sort(), [1, 3, 4, 6])
  assert.deepEqual(chainOf(by, 6), [1, 3, 4, 6])
  assert.equal(pathSet(by, null).size, 0)
})

test('поиск: регистр, поля, undefined-поля (structure), предки раскрываются', () => {
  const { by } = buildIndex(people, directions)
  assert.equal(findMatches(by, '   '), null)
  assert.deepEqual([...findMatches(by, 'ШАХМАТЫ')], [4])
  assert.deepEqual([...findMatches(by, 'ереван')], [5])
  assert.deepEqual([...findMatches(by, 'стм')], [3])
  assert.deepEqual([...forceOpenSet(by, findMatches(by, 'лебедев'))].sort(), [1, 3, 4])
  assert.equal(forceOpenSet(by, null).size, 0)
})

test('collapseLeaders: все с детьми, кроме CEO', () => {
  const { by } = buildIndex(people, directions)
  assert.deepEqual(Object.keys(collapseLeaders(by, 1)).map(Number).sort(), [3, 4, 7])
})

test('cardState: выбран / совпадение / предок / приглушение', () => {
  const { by } = buildIndex(people, directions)
  const path = pathSet(by, 6)
  const matches = findMatches(by, 'орлов')
  assert.deepEqual(cardState(6, { selectedId: 6, matches: null, path }), { mark: 'sel', selected: true, dim: false })
  assert.equal(cardState(4, { selectedId: 6, matches: null, path }).mark, 'anc')
  assert.deepEqual(cardState(4, { selectedId: 6, matches, path }), { mark: 'match', selected: false, dim: false })
  assert.equal(cardState(5, { selectedId: 6, matches, path }).dim, true)
})

const guideOf = (rows, id, level) => rows.find((r) => r.id === id).guides[level - 1]

test('строки дерева: порядок DFS, глубина и сворачивание', () => {
  const { by } = buildIndex(people, directions)
  const base = { by, roots: [3], forceOpen: new Set(), path: new Set() }
  assert.deepEqual(buildRows({ ...base, collapsed: {} }).map((r) => [r.id, r.depth]), [[3, 1], [4, 2], [6, 3], [5, 2]])
  assert.deepEqual(buildRows({ ...base, collapsed: { 4: true } }).map((r) => r.id), [3, 4, 5])
  assert.equal(buildRows({ ...base, collapsed: { 4: true } })[1].open, false)
  // принудительно раскрытая ветка перекрывает collapsed
  assert.deepEqual(buildRows({ ...base, collapsed: { 4: true }, forceOpen: new Set([4]) }).map((r) => r.id), [3, 4, 6, 5])
})

test('направляющие: ├ / └ и «трубы» без выделения', () => {
  const { by } = buildIndex(people, directions)
  const rows = buildRows({ by, roots: [3], collapsed: {}, forceOpen: new Set(), path: new Set() })
  // 3 — единственный корень: └ (top+hor, без bot)
  assert.deepEqual(guideOf(rows, 3, 1), { hasTop: true, topOn: false, hasBot: false, botOn: false, hasHor: true, horOn: false })
  // 4 — не последний ребёнок 3: ├ на уровне 2; на уровне 1 пусто (3 последний)
  assert.deepEqual(guideOf(rows, 4, 2), { hasTop: true, topOn: false, hasBot: true, botOn: false, hasHor: true, horOn: false })
  assert.equal(guideOf(rows, 4, 1).hasTop, false)
  // 6 — внутри ветки 4, а 4 не последний: на уровне 2 труба
  assert.deepEqual(guideOf(rows, 6, 2), { hasTop: true, topOn: false, hasBot: true, botOn: false, hasHor: false, horOn: false })
  // 5 — последний: └
  assert.equal(guideOf(rows, 5, 2).hasBot, false)
})

test('направляющие: красный путь выделения', () => {
  const { by } = buildIndex(people, directions)
  // выбран 5 (последний ребёнок 3): путь 5 -> 3 -> 1
  const rows = buildRows({ by, roots: [3], collapsed: {}, forceOpen: new Set(), path: pathSet(by, 5) })
  const g3 = guideOf(rows, 3, 1)
  assert.equal(g3.topOn, true)
  assert.equal(g3.horOn, true)
  // у 4 (брат выше выбранного 5): top и bot красные (выбранный стоит после), hor — нет
  const g4 = guideOf(rows, 4, 2)
  assert.equal(g4.topOn, true)
  assert.equal(g4.botOn, true)
  assert.equal(g4.horOn, false)
  // у 5: top и hor красные
  const g5 = guideOf(rows, 5, 2)
  assert.equal(g5.topOn, true)
  assert.equal(g5.horOn, true)
  // труба для 6 на уровне 2 (4 не последний, выделенный 5 стоит после) — красная
  assert.equal(guideOf(rows, 6, 2).topOn, true)
  assert.equal(guideOf(rows, 6, 2).botOn, true)
})

test('rootsOnPath: чип CEO красный, если путь идёт через корень направления', () => {
  const { by, dirs } = buildIndex(people, directions)
  const ops = dirs.find((d) => d.id === 'ops')
  assert.equal(rootsOnPath(ops.roots, pathSet(by, 6)), true)
  assert.equal(rootsOnPath(ops.roots, pathSet(by, 8)), false)
})
