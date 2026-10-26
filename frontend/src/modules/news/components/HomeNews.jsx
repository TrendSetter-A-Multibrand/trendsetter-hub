import { useEffect, useState } from 'react'
import { Spin } from 'antd'
import { api } from '../../../core/api/index.js'
import { formatDateTime } from '../../../core/format.js'
import { excerpt, isNewsEditor } from '../lib/news.js'
import strings from '../strings.js'
import NewsItemModal from './NewsItemModal.jsx'
import RsvpControl from './RsvpControl.jsx'
import '../news.css'

const s = strings.home
const r = strings.rsvp

function EventRow({ item, onOpen, onChange }) {
  return (
    <div className="news-row">
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

function NewsRow({ item, onOpen }) {
  return (
    <div className="news-row">
      <div className="news-when mono">{formatDateTime(item.publishedAt)}</div>
      {item.pinned && <div className="news-pin mono">{s.pinned}</div>}
      <button type="button" className="news-title" aria-label={s.openItem(item.title)} onClick={() => onOpen(item.id)}>
        {item.title}
      </button>
      {item.body && <div className="news-excerpt">{excerpt(item.body, 160)}</div>}
    </div>
  )
}

// Блок «Новости» на главной (HOME_WIDGETS, slot 'top'): ближайшие события и последние новости. Обе ленты пусты — блок не рисуется.
export default function HomeNews({ me }) {
  const [feed, setFeed] = useState(null)
  const [failed, setFailed] = useState(false)
  const [openId, setOpenId] = useState(null)

  useEffect(() => {
    let alive = true
    api
      .get('/modules/news/feed')
      .then((result) => alive && setFeed(result))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [])

  // Запись из ответа сервера (после RSVP) подменяет прежнюю в обеих лентах
  const replace = (updated) =>
    setFeed((f) => ({ events: f.events.map((e) => (e.id === updated.id ? updated : e)), news: f.news.map((n) => (n.id === updated.id ? updated : n)) }))

  if (failed) {
    return (
      <section className="home-card" aria-label={s.blockLabel}>
        <div className="news-empty">{s.loadError}</div>
      </section>
    )
  }
  if (feed === null) {
    return (
      <section className="home-card" aria-label={s.blockLabel}>
        <Spin size="small" />
      </section>
    )
  }
  if (feed.events.length === 0 && feed.news.length === 0) return null

  const opened = [...feed.events, ...feed.news].find((i) => i.id === openId)

  return (
    <section className="home-card" aria-label={s.blockLabel}>
      <div className="news-cols">
        <div className="news-col">
          <div className="news-col-title mono">{s.eventsTitle}</div>
          {feed.events.length === 0 ? <div className="news-empty">{s.noEvents}</div> : feed.events.map((e) => <EventRow key={e.id} item={e} onOpen={setOpenId} onChange={replace} />)}
        </div>
        <div className="news-col">
          <div className="news-col-title mono">{s.newsTitle}</div>
          {feed.news.length === 0 ? <div className="news-empty">{s.noNews}</div> : feed.news.map((n) => <NewsRow key={n.id} item={n} onOpen={setOpenId} />)}
        </div>
      </div>
      {opened && <NewsItemModal item={opened} canManage={isNewsEditor(me)} onChange={replace} onClose={() => setOpenId(null)} />}
    </section>
  )
}
