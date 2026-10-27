import { useState } from 'react'
import { Spin } from 'antd'
import { isNewsEditor } from '../lib/news.js'
import strings from '../strings.js'
import NewsItemModal from './NewsItemModal.jsx'
import { EventRow } from './NewsRows.jsx'
import { useFeed } from './useFeed.js'
import '../news.css'

const s = strings.home

// Центральная колонка главной «Ближайшие события» (HOME_WIDGETS, slot 'center'): события с голосованием.
export default function HomeEvents({ me }) {
  const { feed, failed, replace } = useFeed()
  const [openId, setOpenId] = useState(null)
  const opened = feed?.events.find((e) => e.id === openId)

  return (
    <section className="home-panel events" aria-label={s.eventsTitle}>
      <div className="news-col-title mono">{s.eventsTitle}</div>
      {failed ? (
        <div className="news-empty">{s.loadError}</div>
      ) : feed === null ? (
        <Spin size="small" />
      ) : feed.events.length === 0 ? (
        <div className="news-empty">{s.noEvents}</div>
      ) : (
        feed.events.map((e) => <EventRow key={e.id} item={e} onOpen={setOpenId} onChange={replace} />)
      )}
      {opened && <NewsItemModal item={opened} canManage={isNewsEditor(me)} onChange={replace} onClose={() => setOpenId(null)} />}
    </section>
  )
}
