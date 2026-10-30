import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Spin } from 'antd'
import { isNewsEditor } from '../lib/news.js'
import strings from '../strings.js'
import NewsItemModal from './NewsItemModal.jsx'
import ProposalModal from './ProposalModal.jsx'
import { NewsRow } from './NewsRows.jsx'
import { useFeed } from './useFeed.js'
import SectionHead from '../../../core/layout/SectionHead.jsx'
import '../news.css'

const s = strings.home

// Левая колонка главной «Новости» (HOME_WIDGETS, slot 'left'): последние новости, кнопка «Предложить новость» и ссылка «Мои предложения».
export default function HomeNewsFeed({ me }) {
  const { feed, failed, replace } = useFeed()
  const [openId, setOpenId] = useState(null)
  const [proposing, setProposing] = useState(false)
  const opened = feed?.news.find((n) => n.id === openId)

  return (
    <section className="home-block" aria-labelledby="home-news">
      <SectionHead id="home-news" title={s.newsTitle}>
        <Link to="/profile?section=proposals" className="sec-link mono-label">
          {s.myProposals}
        </Link>
        <button type="button" className="sec-link mono-label news-propose" onClick={() => setProposing(true)}>
          {s.propose}
        </button>
      </SectionHead>
      {failed ? (
        <div className="news-empty">{s.loadError}</div>
      ) : feed === null ? (
        <Spin size="small" />
      ) : feed.news.length === 0 ? (
        <div className="news-empty">{s.noNews}</div>
      ) : (
        feed.news.map((n, i) => <NewsRow key={n.id} item={n} featured={i === 0} onOpen={setOpenId} />)
      )}
      {proposing && <ProposalModal item={null} onClose={() => setProposing(false)} onSent={() => setProposing(false)} />}
      {opened && <NewsItemModal item={opened} canManage={isNewsEditor(me)} onChange={replace} onClose={() => setOpenId(null)} />}
    </section>
  )
}
