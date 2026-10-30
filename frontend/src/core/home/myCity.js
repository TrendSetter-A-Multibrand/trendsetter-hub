// «Мой город»: один выбор для часов и погоды (localStorage). Чистые функции, без React.
import { CLOCK_ZONES, formatClock } from './clocks.js'

// Те же 17 городов и зоны, что в CITIES бэкенда (backend/app/core/home.py); порядок — как там
export const CITY_ZONES = [
  { id: 'yerevan', timeZone: 'Asia/Yerevan' },
  { id: 'moscow', timeZone: 'Europe/Moscow' },
  { id: 'saintPetersburg', timeZone: 'Europe/Moscow' },
  { id: 'kazan', timeZone: 'Europe/Moscow' },
  { id: 'krasnodar', timeZone: 'Europe/Moscow' },
  { id: 'yekaterinburg', timeZone: 'Asia/Yekaterinburg' },
  { id: 'novosibirsk', timeZone: 'Asia/Novosibirsk' },
  { id: 'minsk', timeZone: 'Europe/Minsk' },
  { id: 'tbilisi', timeZone: 'Asia/Tbilisi' },
  { id: 'baku', timeZone: 'Asia/Baku' },
  { id: 'almaty', timeZone: 'Asia/Almaty' },
  { id: 'astana', timeZone: 'Asia/Almaty' },
  { id: 'tashkent', timeZone: 'Asia/Tashkent' },
  { id: 'bishkek', timeZone: 'Asia/Bishkek' },
  { id: 'istanbul', timeZone: 'Europe/Istanbul' },
  { id: 'dubai', timeZone: 'Asia/Dubai' },
  { id: 'belgrade', timeZone: 'Europe/Belgrade' },
]

// Города погоды по умолчанию (совпадает с DEFAULT_CITY_IDS бэкенда): их вкладки не убираются
export const DEFAULT_CITY_IDS = ['yerevan', 'moscow']

export const MY_CITY_KEY = 'hub.myCity'

const MOSCOW_TZ = 'Europe/Moscow'

// Неизвестный id, мусор или недоступное хранилище -> null
export function loadMyCity(storage) {
  try {
    const id = storage.getItem(MY_CITY_KEY)
    return CITY_ZONES.some((c) => c.id === id) ? id : null
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
  const my = CITY_ZONES.find((c) => c.id === myCityId)
  const byDefault = !my || my.id === 'yerevan' ? yerevan : my
  const first = stored[0] ? { timeZone: stored[0], cityId: null } : { timeZone: byDefault.timeZone, cityId: byDefault.id }
  const second = stored[1]
    ? { timeZone: stored[1], cityId: null }
    : formatClock(now, first.timeZone) === formatClock(now, MOSCOW_TZ)
      ? { timeZone: yerevan.timeZone, cityId: yerevan.id }
      : { timeZone: moscow.timeZone, cityId: moscow.id }
  return [first, second]
}
