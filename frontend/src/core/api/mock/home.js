// Mock главной: погода и курсы (демо-режим, без сети). Контракт — docs/TZ-home.md, раздел «API».
// Данные детерминированы: 7 дней от сегодняшней даты, синусоида температуры, символы по кругу.
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

// deps: userFromToken(token) — бросает 401 без токена; now — для тестов
export function createHomeHandlers({ userFromToken, now = () => new Date() }) {
  const handlers = {
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
