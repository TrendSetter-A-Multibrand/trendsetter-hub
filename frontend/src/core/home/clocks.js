// Мини-часы главной: только фронтенд, без запросов. Чистые функции, без React.
export const CLOCK_ZONES = [
  { id: 'yerevan', timeZone: 'Asia/Yerevan' },
  { id: 'moscow', timeZone: 'Europe/Moscow' },
  { id: 'paris', timeZone: 'Europe/Paris' },
  { id: 'newYork', timeZone: 'America/New_York' },
]

// 'HH:MM' в часовом поясе зоны
export const formatClock = (date, timeZone) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)

// Миллисекунды до начала следующей минуты
export const msUntilNextMinute = (now = Date.now()) => 60000 - (now % 60000)

// Настраиваемые часы: два слота в localStorage, значение — только IANA-зона.
export const CLOCK_KEYS = ['hub.clock.1', 'hub.clock.2']

// Проверка по try/catch, а не по списку: UTC, Etc/UTC и устаревшие алиасы в supportedValuesOf могут не входить
export function isValidZone(zone) {
  if (typeof zone !== 'string' || !zone) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

// Зона браузера, если валидна, иначе null
export function browserZone(intl = Intl) {
  try {
    const zone = new intl.DateTimeFormat().resolvedOptions().timeZone
    return isValidZone(zone) ? zone : null
  } catch {
    return null
  }
}

// Все зоны для выбора: список браузера (или ключи словаря names) + extra, без дублей
export function allZones(extra = [], intl = Intl, names = {}) {
  const base = typeof intl.supportedValuesOf === 'function' ? intl.supportedValuesOf('timeZone') : Object.keys(names)
  return [...new Set([...base, ...extra.filter(isValidZone)])]
}

// Русское название из словаря, иначе последний сегмент IANA (America/Sao_Paulo -> Sao Paulo)
export const zoneLabel = (zone, names = {}) => names[zone] ?? zone.split('/').pop().replace(/_/g, ' ')

// Смещение 'GMT+3' / 'GMT+5:30'
export function zoneOffset(zone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(now)
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
}

// Сохранённая зона слота (index 0/1) или null: мусор, невалидная зона, недоступное хранилище
export function loadClockZone(storage, index) {
  try {
    const zone = storage.getItem(CLOCK_KEYS[index])
    return isValidZone(zone) ? zone : null
  } catch {
    return null
  }
}

// TODO(Q-AP2): сохраняется только зона — «Казань» после ручного выбора станет «Москва»
export function saveClockZone(storage, index, zone) {
  try {
    storage.setItem(CLOCK_KEYS[index], zone)
  } catch {
    // выбор не сохранится между визитами — не страшно
  }
}
