// «Мой город»: один выбор для часов и погоды (localStorage). Чистые функции, без React.
import { CLOCK_ZONES, formatClock } from './clocks.js'
import { cityById } from './cityCatalog.js'

// Города погоды по умолчанию (совпадает с DEFAULT_CITY_IDS бэкенда): их вкладки не убираются
export const DEFAULT_CITY_IDS = ['yerevan', 'moscow']

export const MY_CITY_KEY = 'hub.myCity'

const MOSCOW_TZ = 'Europe/Moscow'

// Id не из справочника городов (cityCatalog.js), мусор или недоступное хранилище -> null
export function loadMyCity(storage) {
  try {
    const id = storage.getItem(MY_CITY_KEY)
    return cityById(id) ? id : null
  } catch {
    return null
  }
}

export function saveMyCity(storage, idOrNull) {
  try {
    if (idOrNull) storage.setItem(MY_CITY_KEY, idOrNull)
    else storage.removeItem(MY_CITY_KEY)
  } catch {
    // выбор не сохранится между визитами — не страшно
  }
}

// Два слота часов. stored — [зона|null, зона|null] из localStorage (hub.clock.1/2); cityId — id для подписи по умолчанию, у сохранённой зоны null.
// TODO(Q-AP3): пока слот не сохранён, он следует за «моим городом» (правило Q-P2): 01 — мой город; 02 — Москва,
// а если у действующей зоны слота 01 сейчас московское время, то Ереван. Без выбора (или Ереван) — как в V1: Ереван, Москва.
// Сравнивается текущее время, а не id зоны (Минск, Стамбул).
export function clockSlots(myCityId, stored = [null, null], now = new Date()) {
  const [yerevan, moscow] = CLOCK_ZONES
  const my = cityById(myCityId)
  const byDefault = !my || my.id === 'yerevan' ? yerevan : my
  const first = stored[0] ? { timeZone: stored[0], cityId: null } : { timeZone: byDefault.timeZone, cityId: byDefault.id }
  const second = stored[1]
    ? { timeZone: stored[1], cityId: null }
    : formatClock(now, first.timeZone) === formatClock(now, MOSCOW_TZ)
      ? { timeZone: yerevan.timeZone, cityId: yerevan.id }
      : { timeZone: moscow.timeZone, cityId: moscow.id }
  return [first, second]
}
