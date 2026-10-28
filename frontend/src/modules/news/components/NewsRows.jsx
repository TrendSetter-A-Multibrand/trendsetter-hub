import { formatDateTime } from '../../../core/format.js'
import { colorClass, excerpt } from '../lib/news.js'
import strings from '../strings.js'
import RsvpControl from './RsvpControl.jsx'
import '../news.css'

const s = strings.home
const r = strings.rsvp

// Строки лент на главной: цвет записи — модификатор color-<ключ> (фон-тинт и акцент слева, см. news.css)
export function EventRow({ item, onOpen, onChange }) {
  return (
    <div className={`news-row${colorClass(item.color)}`}>
      <div className="news-when mono">{formatDateTime(item.startsAt)}</div>
      {item.pinned && <div className="news-pin mono">{s.pinned}</div>}
      <button type="button" className="news-title" aria-label={s.openItem(item.title)} onClick={() => onOpen(item.id)}>
        {item.title}
      </button>
      {item.place && <div className="news-place">{item.place}</div>}
      {item.rsvp && <div className="news-counts">{r.counts(item.rsvp.counts)}</div>}
      {item.rsvp?.open && <RsvpControl item={item} onChange={onChange} />}
      {item.rsvp && !item.rsvp.open && <div className="news-closed mono">{r.closed}</div>}
    </div>
  )
}

export function NewsRow({ item, onOpen }) {
  return (
    <div className={`news-row${colorClass(item.color)}`}>
      <div className="news-when mono">{formatDateTime(item.publishedAt)}</div>
      {item.pinned && <div className="news-pin mono">{s.pinned}</div>}
      <button type="button" className="news-title" aria-label={s.openItem(item.title)} onClick={() => onOpen(item.id)}>
        {item.title}
      </button>
      {item.body && <div className="news-excerpt">{excerpt(item.body, 160)}</div>}
    </div>
  )
}
