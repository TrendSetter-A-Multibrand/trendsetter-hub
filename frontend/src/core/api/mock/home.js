// Mock главной: погода и курсы (демо-режим, без сети). Контракт — docs/TZ-home.md, раздел «API».
// Данные детерминированы: 7 дней от сегодняшней даты, синусоида температуры, символы по кругу.
import { ApiError } from '../client.js'
import strings from '../../strings.js'
import { addDays, todayIso } from '../../dates.js'

const SYMBOLS = ['clearsky', 'partlycloudy', 'cloudy', 'lightrain', 'rain', 'lightsnow', 'fog']
// Белый список как в backend/app/core/home.py (17 городов, порядок тот же); base — условная «средняя» температура для демо
const CITIES = [
  { id: 'yerevan', timezone: 'Asia/Yerevan', base: 12 },
  { id: 'moscow', timezone: 'Europe/Moscow', base: 4 },
  { id: 'saintPetersburg', timezone: 'Europe/Moscow', base: 2 },
  { id: 'kazan', timezone: 'Europe/Moscow', base: 1 },
  { id: 'krasnodar', timezone: 'Europe/Moscow', base: 10 },
  { id: 'yekaterinburg', timezone: 'Asia/Yekaterinburg', base: -2 },
  { id: 'novosibirsk', timezone: 'Asia/Novosibirsk', base: -5 },
  { id: 'minsk', timezone: 'Europe/Minsk', base: 3 },
  { id: 'tbilisi', timezone: 'Asia/Tbilisi', base: 12 },
  { id: 'baku', timezone: 'Asia/Baku', base: 15 },
  { id: 'almaty', timezone: 'Asia/Almaty', base: 6 },
  { id: 'astana', timezone: 'Asia/Almaty', base: -1 },
  { id: 'tashkent', timezone: 'Asia/Tashkent', base: 14 },
  { id: 'bishkek', timezone: 'Asia/Bishkek', base: 9 },
  { id: 'istanbul', timezone: 'Europe/Istanbul', base: 16 },
  { id: 'dubai', timezone: 'Asia/Dubai', base: 36 },
  { id: 'belgrade', timezone: 'Europe/Belgrade', base: 11 },
]
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

    // ?city=<id>: известный город вне Еревана и Москвы приходит третьим; остальное — 2 города (как бэкенд)
    'GET /core/home/weather': ({ token, query }) => {
      userFromToken(token)
      const today = todayIso(now())
      const extra = CITIES.find((c) => c.id === query?.city && !DEFAULT_CITY_IDS.includes(c.id))
      const list = [...CITIES.filter((c) => DEFAULT_CITY_IDS.includes(c.id)), ...(extra ? [extra] : [])]
      return {
        source: 'MET Norway',
        cities: list.map((c) => {
          const ci = CITIES.indexOf(c)
          const days = Array.from({ length: DAYS }, (_, i) => {
            const max = c.base + Math.round(5 * Math.sin(i))
            return { date: addDays(today, i), min: max - 7, max, symbol: SYMBOLS[i % SYMBOLS.length] }
          })
          // как бэкенд: слоты — только в days[0] («сегодня»), символы зависят от города, чтобы подсказки различались
          const hour = hourIn(c.timezone, now())
          days[0].slots = SLOTS.map(([id, , end], si) => {
            const symbol = SYMBOLS[(ci + si) % SYMBOLS.length]
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
