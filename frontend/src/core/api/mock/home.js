// Mock главной: погода и курсы (демо-режим, без сети). Контракт — docs/TZ-home.md, раздел «API».
// Данные детерминированы: 7 дней от сегодняшней даты, синусоида температуры, символы по кругу.
import { ApiError } from '../client.js'
import strings from '../../strings.js'
import { addDays, todayIso } from '../../dates.js'

const SYMBOLS = ['clearsky', 'partlycloudy', 'cloudy', 'lightrain', 'rain', 'lightsnow', 'fog']
const CITIES = [
  { id: 'yerevan', timezone: 'Asia/Yerevan', base: 12 },
  { id: 'moscow', timezone: 'Europe/Moscow', base: 4 },
]
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

    'GET /core/home/weather': ({ token }) => {
      userFromToken(token)
      const today = todayIso(now())
      return {
        source: 'MET Norway',
        cities: CITIES.map((c) => ({
          id: c.id,
          timezone: c.timezone,
          updatedAt: now().toISOString(),
          stale: false,
          days: Array.from({ length: DAYS }, (_, i) => {
            const max = c.base + Math.round(5 * Math.sin(i))
            return { date: addDays(today, i), min: max - 7, max, symbol: SYMBOLS[i % SYMBOLS.length] }
          }),
        })),
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
