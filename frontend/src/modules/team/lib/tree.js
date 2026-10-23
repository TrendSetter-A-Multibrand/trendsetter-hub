// Чистые производные карты команды (без React): индекс, дети, totalReports, путь выделения,
// совпадения поиска, принудительно раскрытые ветки, строки дерева с направляющими.
// Используется видами «Направления» и «Схема». Все id — числа (как в API); из URL приводить через parseId.

const LEADERSHIP_COLOR = '#A22325'
const ASSISTANT_BG = '#E9E4E1'
const INK = '#252120'

export const initialsOf = (name) => {
  const [a = '', b = ''] = String(name ?? '').trim().split(/\s+/)
  return (a.charAt(0) + b.charAt(0)).toUpperCase()
}

// id из строки URL -> число, если такой человек есть на карте; иначе null
export function parseId(raw, by) {
  if (raw === null || raw === undefined || raw === '') return null
  const id = Number(raw)
  return Number.isInteger(id) && by[id] ? id : null
}

const avatarOf = (p, dir) => {
  if (p.isCeo) return { bg: LEADERSHIP_COLOR, ink: '#FFFFFF' }
  if (p.isAssistant) return { bg: ASSISTANT_BG, ink: INK }
  return { bg: dir?.color ?? ASSISTANT_BG, ink: dir?.avatarInk ?? INK }
}

const searchText = (p) =>
  [p.name, p.title, p.tag, p.team, p.location, p.responsibility, p.askMeAbout, (p.hobbies ?? []).join(' ')]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

// people — PersonPub[] в порядке API; directions — Direction[].
// Руководитель, которого нет в списке (скрыт/в архиве), считается отсутствующим: человек становится корнем своего направления.
export function buildIndex(people, directions) {
  const dirById = Object.fromEntries(directions.map((d) => [d.id, d]))
  const by = {}
  for (const p of people) {
    const dir = dirById[p.directionId] ?? null
    by[p.id] = { ...p, kids: [], mgr: null, total: 0, dir, initials: initialsOf(p.name), av: avatarOf(p, dir), hay: searchText(p) }
  }
  const reachesSelf = (start, target) => {
    for (let c = start, guard = 0; c !== null && guard <= people.length; guard += 1) {
      if (c === target) return true
      c = by[c].mgr
    }
    return false
  }
  for (const p of people) {
    const parent = p.managerId === null || p.managerId === undefined ? null : by[p.managerId]
    if (!parent || reachesSelf(parent.id, p.id)) continue
    by[p.id].mgr = parent.id
    parent.kids.push(p.id)
  }
  const countTotal = (id) => {
    by[id].total = by[id].kids.reduce((sum, k) => sum + 1 + countTotal(k), 0)
    return by[id].total
  }
  Object.values(by).forEach((p) => {
    if (p.mgr === null) countTotal(p.id)
  })

  const ceoId = people.find((p) => p.isCeo)?.id ?? null
  const assistantIds = people.filter((p) => p.isAssistant).map((p) => p.id)
  const isHero = (p) => p.isCeo || p.isAssistant

  const walk = (id, out) => {
    out.push(id)
    by[id].kids.forEach((k) => walk(k, out))
    return out
  }
  const dirs = directions
    .map((d) => {
      const roots = people
        .filter((p) => !isHero(p) && p.directionId === d.id && (by[p.id].mgr === null || by[by[p.id].mgr].directionId !== d.id))
        .map((p) => p.id)
      const ids = roots.flatMap((r) => walk(r, []))
      return { ...d, roots, ids, count: ids.length }
    })
    .filter((d) => d.roots.length > 0)

  const ceoReports = ceoId === null ? 0 : by[ceoId].kids.filter((k) => !by[k].isAssistant).length
  return { by, ceoId, assistantIds, dirs, ceoReports, totalPeople: people.length }
}

// выбранный + все его руководители (до корня); пустое множество, если ничего не выбрано
export function pathSet(by, selectedId) {
  const path = new Set()
  for (let c = selectedId; c !== null && c !== undefined && by[c]; c = by[c].mgr) path.add(c)
  return path
}

// цепочка от верхнего руководителя до id включительно
export function chainOf(by, id) {
  const ids = []
  for (let c = id; c !== null && c !== undefined && by[c]; c = by[c].mgr) ids.unshift(c)
  return ids
}

// множество совпавших id или null, если запрос пустой
export function findMatches(by, query) {
  const q = query.trim().toLowerCase()
  if (!q) return null
  return new Set(Object.values(by).filter((p) => p.hay.includes(q)).map((p) => p.id))
}

// предки совпадений — их ветки раскрываются принудительно
export function forceOpenSet(by, matches) {
  const open = new Set()
  if (!matches) return open
  matches.forEach((id) => {
    for (let c = by[id].mgr; c !== null; c = by[c].mgr) open.add(c)
  })
  return open
}

export const isOpen = (id, collapsed, forceOpen) => !collapsed[id] || forceOpen.has(id)

// «Только руководители»: свернуть всех, у кого есть дети, кроме CEO
export function collapseLeaders(by, ceoId) {
  const collapsed = {}
  Object.values(by).forEach((p) => {
    if (p.kids.length > 0 && p.id !== ceoId) collapsed[p.id] = true
  })
  return collapsed
}

// состояние карточки: 'sel' | 'match' | 'anc' | null и приглушение при поиске
export function cardState(id, { selectedId, matches, path }) {
  const isMatch = Boolean(matches && matches.has(id))
  let mark = null
  if (selectedId === id) mark = 'sel'
  else if (isMatch) mark = 'match'
  else if (path.has(id)) mark = 'anc'
  return { mark, selected: selectedId === id, dim: Boolean(matches) && !isMatch }
}

// Строки панели направления: DFS по раскрытым веткам; guides — сегменты направляющих (24px-ячейки).
// *On = сегмент на пути выделения (красный). Правила — README, раздел «Дерево».
export function buildRows({ by, roots, collapsed, forceOpen, path }) {
  const rows = []
  const pathIndex = (sibs) => sibs.findIndex((s) => path.has(s))
  const dfs = (id, depth, stack) => {
    const p = by[id]
    const guides = stack.map((lv, i) => {
      const level = i + 1
      const last = lv.idx === lv.sibs.length - 1
      const pi = pathIndex(lv.sibs)
      if (level < depth) {
        return last
          ? { hasTop: false, topOn: false, hasBot: false, botOn: false, hasHor: false, horOn: false }
          : { hasTop: true, topOn: pi > lv.idx, hasBot: true, botOn: pi > lv.idx, hasHor: false, horOn: false }
      }
      return { hasTop: true, topOn: pi >= lv.idx, hasBot: !last, botOn: pi > lv.idx, hasHor: true, horOn: pi === lv.idx }
    })
    const open = isOpen(id, collapsed, forceOpen)
    rows.push({ id, depth, guides, open, hasKids: p.kids.length > 0 })
    if (open) p.kids.forEach((k, i) => dfs(k, depth + 1, [...stack, { sibs: p.kids, idx: i }]))
  }
  roots.forEach((r, i) => dfs(r, 1, [{ sibs: roots, idx: i }]))
  return rows
}

// Корни направления лежат под чипом CEO: подсветить чип, если путь идёт через один из них
export const rootsOnPath = (roots, path) => roots.some((r) => path.has(r))
