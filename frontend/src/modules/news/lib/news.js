// Чистые функции модуля «Новости». Без React и браузерных глобалов (storage передаётся параметром).
import { canSeeData } from '../../../core/access.js'
import strings from '../strings.js'

export const HIDDEN_BANNER_KEY = 'hub.news.hiddenBanner'

// Ключи цвета записи (зеркало бэкенд Color и mock/news.js); null = нейтральный. Hex хранится только в news.css.
export const NEWS_COLORS = ['red', 'green', 'yellow', 'blue', 'pink', 'gray']

// Класс цвета записи для .news-row: неизвестный ключ и null — без модификатора
export const colorClass = (color) => (NEWS_COLORS.includes(color) ? ` color-${color}` : '')

// Читатель: view/run на news (viewer на for_all-модуле имеет structure — не читатель). Зеркало бэкенд can_read.
export const canReadNews = (me) => canSeeData(me?.module_access?.news)

// Редактор: «Ответственный» на news или администратор. Зеркало бэкенд is_editor.
// TODO(Q-N3): superuser без явного права не редактор
export const isNewsEditor = (me) => me?.module_responsible?.news === true || me?.can_manage_users === true

const pad = (n) => String(n).padStart(2, '0')

// ISO -> 'YYYY-MM-DDTHH:MM' в зоне браузера (значение для <input type="datetime-local">)
export function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 'YYYY-MM-DDTHH:MM' (зона браузера) -> ISO с Z; пусто/невалидно -> null
// TODO(Q-N6): время вводится и показывается в зоне браузера, не в зоне места события
export function fromLocalInput(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

const MONTHS = ['ЯНВ', 'ФЕВ', 'МАР', 'АПР', 'МАЙ', 'ИЮН', 'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК']

// ISO -> { day: '05', month: 'НОЯ', weekday: 'СР' } для даты-плашки события; невалидная дата -> null
export function eventDateBadge(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return {
    day: pad(d.getDate()),
    month: MONTHS[d.getMonth()],
    weekday: d.toLocaleDateString('ru-RU', { weekday: 'short' }).toUpperCase(),
  }
}

// Состояние формы записи (общей для редактора и предложки) по записи с сервера; item = null — пустая форма
export const initialOf = (item) => ({
  kind: item?.kind ?? 'news',
  title: item?.title ?? '',
  startsAt: toLocalInput(item?.startsAt),
  endsAt: toLocalInput(item?.endsAt),
  place: item?.place ?? '',
  body: item?.body ?? '',
  pinned: item?.pinned ?? false,
  color: item?.color ?? null,
  rsvpEnabled: item?.rsvpEnabled ?? false,
  rsvpDeadline: toLocalInput(item?.rsvpDeadline),
  rsvpNamesPublic: item?.rsvpNamesPublic ?? false,
})

// Клиентская проверка зеркалит серверную; возвращает текст первой ошибки или null
export function validate(f) {
  const errors = strings.editor.errors
  if (!f.title.trim()) return errors.title
  if (f.kind === 'news') return null
  const starts = fromLocalInput(f.startsAt)
  if (starts === null) return errors.starts
  const ends = fromLocalInput(f.endsAt)
  if (ends !== null && ends < starts) return errors.endsBeforeStart
  const deadline = fromLocalInput(f.rsvpDeadline)
  if (deadline !== null && deadline > starts) return errors.deadlineAfterStart
  return null
}

// Тело запроса из формы; withPinned = false (предложка автора) — без pinned
export function payloadOf(f, withPinned = true) {
  const common = { title: f.title.trim(), body: f.body, color: f.color, ...(withPinned ? { pinned: f.pinned } : {}) }
  if (f.kind === 'news') return common
  return {
    ...common,
    place: f.place.trim() || null,
    startsAt: fromLocalInput(f.startsAt),
    endsAt: fromLocalInput(f.endsAt),
    rsvpEnabled: f.rsvpEnabled,
    rsvpDeadline: fromLocalInput(f.rsvpDeadline),
    rsvpNamesPublic: f.rsvpNamesPublic,
  }
}

// Первые limit символов текста; при обрезке — «…»
export function excerpt(text, limit = 160) {
  const value = text ?? ''
  return value.length <= limit ? value : `${value.slice(0, limit).trimEnd()}…`
}

// Плашка скрыта, если в storage лежит её id. Любая ошибка storage = «не скрыта».
export function isBannerHidden(storage, id) {
  try {
    return storage.getItem(HIDDEN_BANNER_KEY) === String(id)
  } catch {
    return false
  }
}

export function hideBanner(storage, id) {
  try {
    storage.setItem(HIDDEN_BANNER_KEY, String(id))
  } catch {
    // тихо игнорируем: плашка просто появится снова при следующем заходе
  }
}
