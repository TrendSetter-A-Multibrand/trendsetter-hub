// Раскладка вида «Схема» (чистая, без React). Порт layoutScheme() из prototype/team-map.dc.html один в один;
// отличия от прототипа: числовые id, любые CEO/ассистенты из данных, раскладка не зависит от выделения
// (красные рёбра выбирает рендер по edge.to + pathSet), дети другого направления в поддерево не входят
// (они — корень своего направления и вешаются на CEO).

export const W = 196 // ширина карточки
export const H = 76 // высота карточки
const HG = 16 // горизонтальный зазор
const VG = 60 // вертикальный зазор
const STK = 26 // отступ стопки
const SG = 12 // зазор в стопке
const ZP = 14 // паддинг зоны
const ZT = 18 // верх зоны над корнями
const ZB = 40 // низ зоны под подпись
const ZG = 28 // между зонами
const M = 40 // поля
const ASST_GAP = 90

// by/ceoId/assistantIds/dirs — из buildIndex; open(id) — раскрыт ли узел; dirFilter — id направления или null
export function layoutScheme({ by, ceoId, assistantIds, dirs, dirFilter, open }) {
  const visibleDirs = dirs.filter((d) => !dirFilter || d.id === dirFilter)
  const allKids = (id) => by[id].kids.filter((k) => by[k].directionId === by[id].directionId)
  const kidsOf = (id) => (open(id) ? allKids(id) : [])
  const stacked = (id) => {
    const k = kidsOf(id)
    return k.length >= 2 && k.every((c) => kidsOf(c).length === 0)
  }

  const meas = {}
  const measure = (id) => {
    const k = kidsOf(id)
    let r
    if (!k.length) r = { w: W, h: H }
    else if (stacked(id)) r = { w: W + STK, h: H + k.length * (H + SG) }
    else {
      const cs = k.map(measure)
      r = { w: Math.max(W, cs.reduce((s, c) => s + c.w, 0) + HG * (k.length - 1)), h: H + VG + Math.max(...cs.map((c) => c.h)) }
    }
    meas[id] = r
    return r
  }

  const pos = {}
  const edges = []
  const vEdge = (p, c) => {
    const px = p.x + W / 2
    const py = p.y + H
    const cx = c.x + W / 2
    const cy = c.y
    const my = py + Math.min(28, (cy - py) / 2)
    edges.push({ from: p.id, to: c.id, d: `M${px} ${py} V${my} H${cx} V${cy - 7}`, a: `M${cx - 5} ${cy - 8} L${cx + 5} ${cy - 8} L${cx} ${cy - 1} Z` })
  }
  const place = (id, x, y) => {
    const m = meas[id]
    const k = kidsOf(id)
    if (!k.length) {
      pos[id] = { id, x, y }
      return
    }
    if (stacked(id)) {
      pos[id] = { id, x, y }
      k.forEach((c, i) => {
        const cy = y + H + SG + i * (H + SG)
        const cx = x + STK
        pos[c] = { id: c, x: cx, y: cy }
        const sx = x + 14
        const my = cy + 26
        edges.push({ from: id, to: c, d: `M${sx} ${y + H} V${my} H${cx - 7}`, a: `M${cx - 8} ${my - 5} L${cx - 8} ${my + 5} L${cx - 1} ${my} Z` })
      })
      return
    }
    const tot = k.reduce((s, c) => s + meas[c].w, 0) + HG * (k.length - 1)
    let cx = x + (m.w - tot) / 2
    k.forEach((c) => {
      place(c, cx, y + H + VG)
      cx += meas[c].w + HG
    })
    const f = pos[k[0]]
    const l = pos[k[k.length - 1]]
    pos[id] = { id, x: (f.x + l.x) / 2, y }
    k.forEach((c) => vEdge(pos[id], pos[c]))
  }

  const rootY = M + H + VG + ZT
  let x = M
  const zones = []
  visibleDirs.forEach((d) => {
    d.roots.forEach(measure)
    const rw = d.roots.reduce((s, r) => s + meas[r].w, 0) + HG * (d.roots.length - 1)
    let rx = x + ZP
    d.roots.forEach((r) => {
      place(r, rx, rootY)
      rx += meas[r].w + HG
    })
    const zh = Math.max(...d.roots.map((r) => meas[r].h))
    zones.push({ id: d.id, x, y: rootY - ZT, w: rw + ZP * 2, h: zh + ZT + ZB, label: d.label, count: d.count, color: d.color, bg: `${d.color}14`, border: `${d.color}40` })
    x += rw + ZP * 2 + ZG
  })

  const allRoots = visibleDirs.flatMap((d) => d.roots)
  const nodes = Object.values(pos).map((p) => {
    const all = allKids(p.id)
    return { id: p.id, x: p.x, y: p.y, expandable: all.length > 0, open: open(p.id) }
  })
  if (allRoots.length === 0) return { zones, nodes, edges, assistants: [], rawW: 0, rawH: 0, ceoCx: 0 }

  const f = pos[allRoots[0]]
  const l = pos[allRoots[allRoots.length - 1]]
  let ceoCx = (f.x + l.x) / 2 + W / 2
  let rawW = x - ZG + M
  const assistants = []
  if (ceoId !== null) {
    const ceo = { id: ceoId, x: (f.x + l.x) / 2, y: M }
    pos[ceoId] = ceo
    nodes.push({ id: ceoId, x: ceo.x, y: ceo.y, expandable: false, open: true })
    allRoots.forEach((r) => vEdge(ceo, pos[r]))
    ceoCx = ceo.x + W / 2
    if (!dirFilter) {
      assistantIds.forEach((id, i) => {
        const ax = ceo.x + (W + ASST_GAP) * (i + 1)
        nodes.push({ id, x: ax, y: M, expandable: false, open: true })
        assistants.push({ id, lx: ax - ASST_GAP + 8, lw: 74, ly: M + H / 2, ty: M + H / 2 - 16 })
        rawW = Math.max(rawW, ax + W + M)
      })
    }
  }
  const rawH = Math.max(...zones.map((z) => z.y + z.h)) + M + 30
  return { zones, nodes, edges, assistants, rawW, rawH, ceoCx }
}
