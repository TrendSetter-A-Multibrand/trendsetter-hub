import { formatDateTime } from '../../../core/format.js'
import { colorClass, excerpt } from '../lib/news.js'
import strings from '../strings.js'
import RsvpControl from './RsvpControl.jsx'
import '../news.css'

const s = strings.home
const r = strings.rsvp

// Строки лент на главной: строки через тонкие линии. Цвет записи — маленький квадрат у даты (color-<ключ>, news.css),
// закреплённая — компактная метка рядом с датой.
function Meta({ when, pinned }) {
  return (
    <div className="news-meta">
      <span className="news-dot" aria-hidden="true" />
      <span className="news-when mono">{formatDateTime(when)}</span>
      {pinned && <span className="news-pin">{s.pinned}</span>}
    </div>
  )
}

export function EventRow({ item, onOpen, onChange }) {
  return (
    <div className={`news-row${colorClass(item.color)}`}>
      <Meta when={item.startsAt} pinned={item.pinned} />
      <button type="button" className="news-title" aria-label={s.openItem(item.title)} onClick={() => onOpen(item.id)}>
        {item.title}
      </button>
      {item.place && <div className="news-place">{item.place}</div>}
      {item.rsvp && <div className="news-counts">{r.counts(item.rsvp.counts)}</div>}
      {item.rsvp?.open && <RsvpControl item={item} onChange={onChange} />}
      {item.rsvp && !item.rsvp.open && <div className="news-closed">{r.closed}</div>}
    </div>
  )
}

export function NewsRow({ item, onOpen }) {
  return (
    <div className={`news-row${colorClass(item.color)}`}>
      <Meta when={item.publishedAt} pinned={item.pinned} />
      <button type="button" className="news-title" aria-label={s.openItem(item.title)} onClick={() => onOpen(item.id)}>
        {item.title}
      </button>
      {item.body && <div className="news-excerpt">{excerpt(item.body, 160)}</div>}
    </div>
  )
}
