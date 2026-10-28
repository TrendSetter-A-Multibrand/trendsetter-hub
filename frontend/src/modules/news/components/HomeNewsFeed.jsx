import { useState } from 'react'
import { Spin } from 'antd'
import { isNewsEditor } from '../lib/news.js'
import strings from '../strings.js'
import NewsItemModal from './NewsItemModal.jsx'
import { NewsRow } from './NewsRows.jsx'
import { useFeed } from './useFeed.js'
import '../news.css'

const s = strings.home

// Левая колонка главной «Новости» (HOME_WIDGETS, slot 'left'): последние новости.
export default function HomeNewsFeed({ me }) {
  const { feed, failed, replace } = useFeed()
  const [openId, setOpenId] = useState(null)
  const opened = feed?.news.find((n) => n.id === openId)

  return (
    <section className="home-panel news" aria-label={s.newsTitle}>
      <div className="news-col-title">{s.newsTitle}</div>
      {failed ? (
        <div className="news-empty">{s.loadError}</div>
      ) : feed === null ? (
        <Spin size="small" />
      ) : feed.news.length === 0 ? (
        <div className="news-empty">{s.noNews}</div>
      ) : (
        feed.news.map((n) => <NewsRow key={n.id} item={n} onOpen={setOpenId} />)
      )}
      {opened && <NewsItemModal item={opened} canManage={isNewsEditor(me)} onChange={replace} onClose={() => setOpenId(null)} />}
    </section>
  )
}
