// Мини-часы главной: только фронтенд, без запросов. Чистые функции, без React.
export const CLOCK_ZONES = [
  { id: 'yerevan', timeZone: 'Asia/Yerevan' },
  { id: 'moscow', timeZone: 'Europe/Moscow' },
]

// 'HH:MM' в часовом поясе зоны
export const formatClock = (date, timeZone) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)

// Миллисекунды до начала следующей минуты
export const msUntilNextMinute = (now = Date.now()) => 60000 - (now % 60000)
