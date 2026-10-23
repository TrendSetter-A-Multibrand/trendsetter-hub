// Опции для Select из справочников HR (без React).

export const directionOptions = (directions) => directions.map((d) => ({ value: d.id, label: d.shortName }))

// Руководители: активные карточки; exclude — id, которые убрать (сам человек)
export const managerOptions = (people, exclude = []) =>
  people
    .filter((p) => !p.isArchived && !exclude.includes(p.id))
    .map((p) => ({ value: p.id, label: `${p.name} · ${p.title}` }))

export const personName = (people, id) => people.find((p) => p.id === id)?.name ?? null

// «Фамилия Имя» хаба -> { lastName, firstName }
export function splitFullName(fullName) {
  const [last = '', ...rest] = String(fullName ?? '').trim().split(/\s+/)
  return { lastName: last, firstName: rest.join(' ') }
}
