import { formatDate } from '../../../core/dates.js'
import { colorClass, eventDateBadge, excerpt } from '../lib/news.js'
import strings from '../strings.js'
import RsvpControl from './RsvpControl.jsx'
import '../news.css'

const s = strings.home
const r = strings.rsvp

// ISO с временем -> '28.10.2026' (дата публикации в ленте)
const day = (iso) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return formatDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
}

// Событие: крупная красная дата, название, место и итоги ответов, сегменты «Иду / Думаю / Не иду»
export function EventRow({ item, onOpen, onChange }) {
  const badge = eventDateBadge(item.startsAt)
  const meta = [item.place, item.rsvp && r.summary(item.rsvp.counts)].filter(Boolean).join(' · ')
  return (
    <article className={`event-row${colorClass(item.color)}`}>
      {badge && (
        <span className="event-date" aria-hidden="true">
          <span className="event-day">{badge.day}</span>
          <span className="event-month">
            {badge.month} · {badge.weekday}
          </span>
        </span>
      )}
      <span className="event-body">
        {item.pinned && <span className="news-pin">{s.pinned}</span>}
        <button type="button" className="news-title" aria-label={s.openItem(item.title)} onClick={() => onOpen(item.id)}>
          {item.title}
        </button>
        {meta && <span className="event-meta">{meta}</span>}
      </span>
      {item.rsvp?.open && <RsvpControl item={item} onChange={onChange} />}
      {item.rsvp && !item.rsvp.open && <span className="news-closed">{r.closed}</span>}
    </article>
  )
}

// Первая новость — витрина на плашке; остальные — строки «дата | заголовок и текст» через линию
export function NewsRow({ item, onOpen, featured }) {
  if (featured) {
    return (
      <div className={`news-featured${colorClass(item.color)}`}>
        <span className="news-meta">
          {item.pinned && <span className="news-pin">{s.pinned}</span>}
          <span>{day(item.publishedAt)}</span>
        </span>
        <button type="button" className="news-featured-title" aria-label={s.openItem(item.title)} onClick={() => onOpen(item.id)}>
          {item.title}
        </button>
        {item.body && <span className="news-featured-text">{excerpt(item.body, 220)}</span>}
        <button type="button" className="news-read-more" onClick={() => onOpen(item.id)}>
          {s.readMore}
        </button>
      </div>
    )
  }
  return (
    <div className={`news-row${colorClass(item.color)}`}>
      <span className="news-when">{day(item.publishedAt)}</span>
      <span className="news-row-body">
        {item.pinned && <span className="news-pin">{s.pinned}</span>}
        <button type="button" className="news-title" aria-label={s.openItem(item.title)} onClick={() => onOpen(item.id)}>
          {item.title}
        </button>
        {item.body && <span className="news-excerpt">{excerpt(item.body, 160)}</span>}
      </span>
    </div>
  )
}
