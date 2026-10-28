import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Modal } from 'antd'
import { api } from '../../../core/api/index.js'
import { formatDateTime } from '../../../core/format.js'
import strings from '../strings.js'
import RsvpControl from './RsvpControl.jsx'
import '../news.css'

const s = strings.item
const r = strings.rsvp
const GROUPS = ['yes', 'maybe', 'no']

// «Кто идёт»: три списка имён. Загружается при открытии и после смены своего ответа; ошибка — короткий текст, модалка работает.
function Who({ item }) {
  const [names, setNames] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    api
      .get(`/modules/news/items/${item.id}/responses`)
      .then((result) => alive && (setNames(result), setFailed(false)))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [item.id, item.rsvp.myAnswer])

  return (
    <div className="news-who">
      <div className="news-who-title">{r.whoTitle}</div>
      {failed && <div className="news-note">{r.namesLoadError}</div>}
      {names &&
        GROUPS.map((group) => (
          <div className="news-who-group" key={group}>
            <strong>{r.group(r[group], names[group].length)}</strong>
            {names[group].length === 0 ? <div className="news-note">{r.nobody}</div> : <div>{names[group].map((p) => p.name).join(', ')}</div>}
          </div>
        ))}
    </div>
  )
}

// Подробности записи: полный текст (plain text, pre-wrap), время, место, срок ответа, RSVP.
export default function NewsItemModal({ item, canManage, onChange, onClose }) {
  const isEvent = item.kind === 'event'

  return (
    <Modal open title={item.title} footer={null} onCancel={onClose}>
      {isEvent ? (
        <dl className="news-facts">
          <dt>{s.starts}</dt>
          <dd>{formatDateTime(item.startsAt)}</dd>
          {item.endsAt && (
            <>
              <dt>{s.ends}</dt>
              <dd>{formatDateTime(item.endsAt)}</dd>
            </>
          )}
          {item.place && (
            <>
              <dt>{s.place}</dt>
              <dd>{item.place}</dd>
            </>
          )}
        </dl>
      ) : (
        <div className="news-when mono">
          {s.published} · {formatDateTime(item.publishedAt)}
        </div>
      )}
      {/* TODO(Q-N8): только plain text (pre-wrap); ссылки в тексте не кликабельны */}
      {item.body && <div className="news-text">{item.body}</div>}
      {item.rsvp && (
        <div className="news-who">
          <div className="news-counts">{r.counts(item.rsvp.counts)}</div>
          {item.rsvpDeadline && <div className="news-note">{r.deadline(formatDateTime(item.rsvpDeadline))}</div>}
          {item.rsvp.open ? <RsvpControl item={item} onChange={onChange} /> : <div className="news-closed">{r.closed}</div>}
          {item.rsvp.canSeeNames && <Who item={item} />}
        </div>
      )}
      {canManage && (
        <div className="news-who">
          <Link to="/profile?section=news" onClick={onClose}>
            {strings.home.manage}
          </Link>
        </div>
      )}
    </Modal>
  )
}
