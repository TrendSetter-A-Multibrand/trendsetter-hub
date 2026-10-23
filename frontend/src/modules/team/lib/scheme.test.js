import test from 'node:test'
import assert from 'node:assert/strict'
import { buildIndex, isOpen } from './tree.js'
import { H, W, layoutScheme, zoomAt } from './scheme.js'

const directions = [
  { id: 'leadership', label: 'РУКОВОДСТВО', shortName: 'Руководство', color: '#A22325', avatarInk: '#FFFFFF' },
  { id: 'ops', label: 'ОПЕРАЦИИ', shortName: 'Операции', color: '#1D428A', avatarInk: '#FFFFFF' },
  { id: 'buy', label: 'ЗАКУПКИ', shortName: 'Закупки', color: '#F3D03E', avatarInk: '#252120' },
]
const person = (id, managerId, directionId, extra = {}) => ({ id, name: `Имя${id} Фам${id}`, title: 'Должность', managerId, directionId, ...extra })

//  1 CEO ── 2 ассистент
//        ├─ 3 ops ── 4 (лист), 5 (лист), 6 ── 7
//        └─ 8 buy ── 9
const people = [
  person(1, null, 'leadership', { isCeo: true }),
  person(2, 1, 'leadership', { isAssistant: true }),
  person(3, 1, 'ops'),
  person(4, 3, 'ops'),
  person(5, 3, 'ops'),
  person(6, 3, 'ops'),
  person(7, 6, 'ops'),
  person(8, 1, 'buy'),
  person(9, 8, 'buy'),
]

const run = (list, { collapsed = {}, dirFilter = null } = {}) => {
  const idx = buildIndex(list, directions)
  const layout = layoutScheme({
    by: idx.by,
    ceoId: idx.ceoId,
    assistantIds: idx.assistantIds,
    dirs: idx.dirs,
    dirFilter,
    open: (id) => isOpen(id, collapsed, new Set()),
  })
  const at = Object.fromEntries(layout.nodes.map((n) => [n.id, n]))
  return { idx, layout, at }
}

test('ряд детей: родитель по центру между первым и последним', () => {
  const { at } = run(people)
  // у 3 есть не-лист (6 с ребёнком) -> не стопка
  assert.equal(at[4].y, at[5].y)
  assert.equal(at[3].x, (at[4].x + at[6].x) / 2)
  assert.equal(at[4].y - at[3].y, H + 60)
})

test('стопка листьев: >=2 детей-листьев идут вертикально со сдвигом 26', () => {
  const { at, layout } = run(people, { collapsed: { 6: true } })
  assert.equal(at[4].x, at[3].x + 26)
  assert.equal(at[5].x, at[3].x + 26)
  assert.equal(at[5].y - at[4].y, H + 12)
  assert.equal(at[4].y, at[3].y + H + 12)
  const e = layout.edges.find((x) => x.to === 4)
  assert.equal(e.d, `M${at[3].x + 14} ${at[3].y + H} V${at[4].y + 26} H${at[4].x - 7}`)
})

test('один ребёнок-лист не стопка', () => {
  const { at } = run(people, { collapsed: { 6: true } })
  assert.equal(at[9].x, at[8].x)
  assert.equal(at[9].y, at[8].y + H + 60)
})

test('зоны идут слева направо, охватывают поддеревья, счётчик = count направления', () => {
  const { layout, idx } = run(people)
  assert.deepEqual(layout.zones.map((z) => z.id), ['ops', 'buy'])
  const [ops, buy] = layout.zones
  assert.equal(buy.x, ops.x + ops.w + 28)
  assert.equal(ops.count, idx.dirs[0].count)
  assert.equal(ops.bg, '#1D428A14')
  assert.equal(ops.border, '#1D428A40')
})

test('CEO по центру между первым и последним корнем, рёбра CEO -> корни', () => {
  const { at, layout } = run(people)
  assert.equal(at[1].x, (at[3].x + at[8].x) / 2)
  assert.equal(at[1].y, 40)
  assert.deepEqual(layout.edges.filter((e) => e.from === 1).map((e) => e.to), [3, 8])
  assert.equal(layout.ceoCx, at[1].x + W / 2)
})

test('ассистент справа от CEO на +90 только без фильтра', () => {
  const { at, layout } = run(people)
  assert.equal(at[2].x, at[1].x + W + 90)
  assert.equal(layout.assistants[0].lx, at[1].x + W + 8)
  assert.ok(layout.rawW >= at[2].x + W + 40)
  const f = run(people, { dirFilter: 'buy' })
  assert.equal(f.at[2], undefined)
  assert.equal(f.layout.assistants.length, 0)
  assert.equal(f.at[3], undefined)
  assert.ok(f.at[8] && f.at[1])
})

test('рёбра ряда: ствол вниз, горизонталь, стрелка', () => {
  const { at, layout } = run(people)
  const e = layout.edges.find((x) => x.to === 6)
  const px = at[3].x + W / 2
  const cx = at[6].x + W / 2
  assert.equal(e.d, `M${px} ${at[3].y + H} V${at[3].y + H + 28} H${cx} V${at[6].y - 7}`)
  assert.equal(e.a, `M${cx - 5} ${at[6].y - 8} L${cx + 5} ${at[6].y - 8} L${cx} ${at[6].y - 1} Z`)
})

test('свёрнутая ветка скрывает детей; expandable остаётся', () => {
  const { at } = run(people, { collapsed: { 3: true } })
  assert.equal(at[4], undefined)
  assert.equal(at[3].expandable, true)
  assert.equal(at[3].open, false)
  assert.equal(at[9].expandable, false)
})

test('перестраивается при смене данных: новый человек / новый руководитель', () => {
  const before = run(people)
  const more = run([...people, person(10, 3, 'ops')])
  assert.ok(more.at[10])
  assert.ok(more.layout.rawW > before.layout.rawW)
  const moved = run(people.map((p) => (p.id === 9 ? { ...p, managerId: 3, directionId: 'ops' } : p)))
  assert.equal(moved.at[8].expandable, false)
  assert.equal(moved.layout.edges.some((e) => e.from === 8), false)
})

test('нет CEO и пустая схема не падают', () => {
  const noCeo = run(people.filter((p) => !p.isCeo).map((p) => (p.managerId === 1 ? { ...p, managerId: null } : p)))
  assert.ok(noCeo.layout.nodes.length > 0)
  const empty = run([person(1, null, 'leadership', { isCeo: true })])
  assert.equal(empty.layout.rawW, 0)
})

test('60+ человек раскладываются без накладок карточек', () => {
  const list = [person(1, null, 'leadership', { isCeo: true })]
  let id = 2
  for (let d = 0; d < 5; d += 1) {
    const root = id++
    list.push(person(root, 1, 'ops'))
    for (let m = 0; m < 3; m += 1) {
      const mid = id++
      list.push(person(mid, root, 'ops'))
      for (let k = 0; k < 3; k += 1) list.push(person(id++, mid, 'ops'))
    }
  }
  const { layout } = run(list)
  assert.equal(layout.nodes.length, list.length)
  const cells = layout.nodes.map((n) => `${n.x}:${n.y}`)
  assert.equal(new Set(cells).size, cells.length)
  for (const a of layout.nodes) for (const b of layout.nodes) {
    if (a.id < b.id && a.y === b.y) assert.ok(Math.abs(a.x - b.x) >= W, `${a.id}/${b.id} пересекаются`)
  }
})

test('zoomAt: точка под курсором остаётся на месте', () => {
  const r = zoomAt({ zoom: 0.8, delta: 0.1, scrollLeft: 100, scrollTop: 50, px: 200, py: 80 })
  assert.equal(r.zoom, 0.9)
  assert.ok(Math.abs((100 + 200) / 0.8 - (r.scrollLeft + 200) / 0.9) < 1e-9)
  assert.ok(Math.abs((50 + 80) / 0.8 - (r.scrollTop + 80) / 0.9) < 1e-9)
})

test('zoomAt: границы 0.3 и 1.5 и неотрицательный scroll', () => {
  assert.deepEqual(zoomAt({ zoom: 1.5, delta: 0.1, scrollLeft: 5, scrollTop: 6, px: 1, py: 1 }), { zoom: 1.5, scrollLeft: 5, scrollTop: 6 })
  const r = zoomAt({ zoom: 0.4, delta: -0.1, scrollLeft: 0, scrollTop: 0, px: 0, py: 0 })
  assert.equal(r.zoom, 0.3)
  assert.equal(r.scrollLeft, 0)
})
