import { useState } from 'react'
import { Button } from 'antd'
import { useAuth } from '../../core/auth/useAuth.js'
import SectionHead from '../../core/layout/SectionHead.jsx'
import strings from './strings.js'
import BannerEditor from './components/BannerEditor.jsx'
import HomeWidgetsEditor from './components/HomeWidgetsEditor.jsx'
import NewsColumn from './components/NewsColumn.jsx'
import NewsEditorDrawer from './components/NewsEditorDrawer.jsx'
import ResponsesModal from './components/ResponsesModal.jsx'
import './news.css'

const s = strings.admin
const TABS = ['review', 'current', 'past', 'drafts']

// Вкладка «Новости» страницы «Администрация» (/office?tab=news, только редактор): три колонки — «Новости» (срочная плашка + список),
// «События» (список) и «Виджеты» (виджеты главной). Статус — один общий переключатель для колонок «Новости» и «События».
// TODO(Q-AP7): общий переключатель статусов, у каждой колонки своя пагинация.
export default function NewsAdminSection() {
  const { me, refreshMe } = useAuth()
  const [tab, setTab] = useState('review')
  const [editing, setEditing] = useState(undefined) // undefined — закрыто, null — новая запись, объект — правка
  const [defaultKind, setDefaultKind] = useState(undefined) // тип новой записи: кнопки «+ Новость» / «+ Событие»
  const [reviewing, setReviewing] = useState(null) // предложение в панели проверки
  const [responsesOf, setResponsesOf] = useState(null)

  const [version, setVersion] = useState(0) // растёт после изменений: списки перечитываются
  // После любого изменения перечитываем списки и /core/me (бейдж пункта меню — число предложений на проверке)
  const reload = () => {
    setVersion((v) => v + 1)
    refreshMe()
  }
  const pending = me.module_badges?.news ?? 0

  const add = (kind) => {
    setDefaultKind(kind)
    setEditing(null)
  }
  const column = (kind) => (
    <NewsColumn
      key={`${kind}-${tab}`}
      kind={kind}
      tab={tab}
      version={version}
      onEdit={setEditing}
      onReview={setReviewing}
      onResponses={setResponsesOf}
      onChanged={reload}
    />
  )

  return (
    <div className="stack module news">
      <span className="seg" role="group" aria-label={s.tabsLabel}>
        {TABS.map((value) => (
          <button key={value} type="button" className="seg-btn" aria-pressed={tab === value} onClick={() => setTab(value)}>
            {s.tabs[value]}
            {value === 'review' && pending > 0 && <span className="nav-badge news-tab-badge">{pending}</span>}
          </button>
        ))}
      </span>
      <div className="news-cols">
        <div className="news-col">
          <section className="news-admin" aria-labelledby="news-banner">
            <SectionHead id="news-banner" title={s.bannerTitle} />
            <BannerEditor />
          </section>
          <section className="news-admin" aria-labelledby="news-col-news">
            <SectionHead id="news-col-news" title={s.columns.news}>
              <Button size="small" type="primary" onClick={() => add('news')}>
                {s.addNews}
              </Button>
            </SectionHead>
            {column('news')}
          </section>
        </div>
        <section className="news-admin news-col" aria-labelledby="news-col-events">
          <SectionHead id="news-col-events" title={s.columns.events}>
            <Button size="small" type="primary" onClick={() => add('event')}>
              {s.addEvent}
            </Button>
          </SectionHead>
          {column('event')}
        </section>
        <section className="news-admin news-col news-col-widgets" aria-labelledby="news-widgets">
          <HomeWidgetsEditor />
        </section>
      </div>
      {editing !== undefined && (
        <NewsEditorDrawer
          item={editing}
          defaultKind={defaultKind}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined)
            reload()
          }}
        />
      )}
      {reviewing && (
        <NewsEditorDrawer
          item={reviewing}
          mode="review"
          onClose={() => setReviewing(null)}
          onSaved={() => {
            setReviewing(null)
            reload()
          }}
        />
      )}
      {responsesOf && <ResponsesModal item={responsesOf} onClose={() => setResponsesOf(null)} />}
    </div>
  )
}
