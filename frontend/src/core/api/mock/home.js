// Mock главной: погода и курсы (демо-режим, без сети). Контракт — docs/TZ-home.md, раздел «API».
// Данные детерминированы: 7 дней от сегодняшней даты, синусоида температуры, символы по кругу.
import { ApiError } from '../client.js'
import strings from '../../strings.js'
import { addDays, todayIso } from '../../dates.js'
import { cityById } from '../../home/cityCatalog.js'

const SYMBOLS = ['clearsky', 'partlycloudy', 'cloudy', 'lightrain', 'rain', 'lightsnow', 'fog']
// Белый список — справочник городов (cityCatalog.js, тот же состав, что home_cities.json бэкенда); base — условная «средняя» температура для демо:
// для 17 прежних городов — фиксированная, для остальных детерминированно из хэша id (от -5 до +30)
const LEGACY_BASE = {
  yerevan: 12, moscow: 4, saintPetersburg: 2, kazan: 1, krasnodar: 10, yekaterinburg: -2, novosibirsk: -5, minsk: 3, tbilisi: 12,
  baku: 15, almaty: 6, astana: -1, tashkent: 14, bishkek: 9, istanbul: 16, dubai: 36, belgrade: 11,
}
const LEGACY_IDS = Object.keys(LEGACY_BASE)
const hashOf = (id) => [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0)
const mockCity = (id) => {
  const city = typeof id === 'string' ? cityById(id) : null
  return city && { id, timezone: city.timeZone, base: LEGACY_BASE[id] ?? -5 + (hashOf(id) % 36), index: LEGACY_IDS.includes(id) ? LEGACY_IDS.indexOf(id) : hashOf(id) % SYMBOLS.length }
}
const DEFAULT_CITY_IDS = ['yerevan', 'moscow']
// Окна дня: [id, начало, конец] по местному времени, как SLOTS на бэкенде
const SLOTS = [['morning', 6, 11], ['noon', 11, 13], ['lunch', 13, 17], ['evening', 17, 22]]
const hourIn = (timeZone, date) =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(date))

const DAYS = 7

const RATES = [
  { code: 'USD', nominal: 1, value: 81.1234, previous: 80.9876 },
  { code: 'EUR', nominal: 1, value: 94.5, previous: 94.7 },
  { code: 'AMD', nominal: 100, value: 22.3011, previous: 22.4519 },
]

const WIDGET_ID = /^[a-z0-9-]{1,40}$/
const WIDGETS_MAX = 30

// deps: userFromToken(token) — бросает 401 без токена; canEditWidgets(user) — admin или ответственный модуля с homeEditor (решает handlers.js);
// now — для тестов
export function createHomeHandlers({ userFromToken, canEditWidgets = () => false, now = () => new Date() }) {
  // Виджеты главной: пусто = порядок по умолчанию, всё включено; одна настройка на всех
  let widgets = []

  const handlers = {
    'GET /core/home/widgets': ({ token }) => {
      userFromToken(token)
      return { widgets: widgets.map((w) => ({ ...w })) }
    },

    'POST /core/home/widgets': ({ token, body }) => {
      const user = userFromToken(token)
      if (!canEditWidgets(user)) throw new ApiError(403, strings.errors.forbidden)
      const list = body?.widgets
      const valid =
        Array.isArray(list) &&
        list.length >= 1 &&
        list.length <= WIDGETS_MAX &&
        list.every((w) => w && typeof w.id === 'string' && WIDGET_ID.test(w.id) && typeof w.enabled === 'boolean') &&
        new Set(list.map((w) => w.id)).size === list.length
      if (!valid) throw new ApiError(422, strings.errors.invalid)
      widgets = list.map((w) => ({ id: w.id, enabled: w.enabled }))
      return { widgets: widgets.map((w) => ({ ...w })) }
    },

    // ?city=<id>: город справочника вне Еревана и Москвы приходит третьим; остальное — 2 города (как бэкенд)
    'GET /core/home/weather': ({ token, query }) => {
      userFromToken(token)
      const today = todayIso(now())
      const extra = DEFAULT_CITY_IDS.includes(query?.city) ? null : mockCity(query?.city)
      const list = [...DEFAULT_CITY_IDS.map(mockCity), ...(extra ? [extra] : [])]
      return {
        source: 'MET Norway',
        cities: list.map((c) => {
          const days = Array.from({ length: DAYS }, (_, i) => {
            const max = c.base + Math.round(5 * Math.sin(i))
            return { date: addDays(today, i), min: max - 7, max, symbol: SYMBOLS[i % SYMBOLS.length] }
          })
          // как бэкенд: слоты — только в days[0] («сегодня»), символы зависят от города, чтобы подсказки различались
          const hour = hourIn(c.timezone, now())
          days[0].slots = SLOTS.map(([id, , end], si) => {
            const symbol = SYMBOLS[(c.index + si) % SYMBOLS.length]
            const temp = days[0].max - 3 + si
            return {
              id,
              temp,
              tempMin: temp - 1,
              tempMax: temp + 1,
              symbols: [symbol],
              precip: symbol.includes('rain') || symbol.includes('snow') ? 1.2 : 0,
              wind: 3,
              past: hour >= end,
            }
          })
          return { id: c.id, timezone: c.timezone, updatedAt: now().toISOString(), stale: false, days }
        }),
      }
    },

    'GET /core/home/rates': ({ token }) => {
      userFromToken(token)
      const today = todayIso(now())
      return {
        source: 'ЦБ РФ',
        date: today,
        previousDate: addDays(today, -1),
        stale: false,
        rates: RATES.map((r) => ({ ...r, perUnit: Math.round((r.value / r.nominal) * 1e6) / 1e6 })),
      }
    },
  }
  return { handlers }
}
