import { useEffect, useState } from 'react'
import { Alert, App, Button, Pagination, Popconfirm, Segmented, Spin, Tag } from 'antd'
import { api } from '../../core/api/index.js'
import { useAuth } from '../../core/auth/useAuth.js'
import { formatDateTime } from '../../core/format.js'
import strings from './strings.js'
import BannerEditor from './components/BannerEditor.jsx'
import NewsEditorDrawer from './components/NewsEditorDrawer.jsx'
import ResponsesModal from './components/ResponsesModal.jsx'
import './news.css'

const s = strings.admin
const r = strings.rsvp
const TABS = ['review', 'current', 'past', 'drafts']
const PROPOSAL_STATES = ['pending', 'needs_changes', 'rejected']

const statusOf = (item) => (item.status !== 'published' ? item.status : item.archived ? 'archived' : 'published')

function ItemRow({ item, onEdit, onReview, onResponses, onPatch, onRemove }) {
  const state = statusOf(item)
  const isProposal = PROPOSAL_STATES.includes(item.status)
  const isDraft = item.status === 'draft'
  return (
    <div className="news-admin-item">
      <div className="news-admin-head">
        <Tag>{s.kinds[item.kind]}</Tag>
        <Tag color={state === 'published' ? 'green' : undefined}>{s.status[state]}</Tag>
        {item.pinned && <span className="news-pin">{strings.home.pinned}</span>}
        <span className="news-admin-title">{item.title}</span>
      </div>
      <div className="news-when mono">
        {formatDateTime(item.startsAt ?? item.publishedAt ?? item.updatedAt)}
        {item.place && ` · ${item.place}`}
      </div>
      {item.review && (
        <div className="news-note">
          {item.review.author ? s.author(item.review.author.name) : s.authorDeleted} · {s.sentAt(formatDateTime(item.review.submittedAt))}
          {item.review.reviewComment && ` · ${s.comment(item.review.reviewComment)}`}
        </div>
      )}
      {item.rsvp && (
        <div className="news-counts">
          {r.counts(item.rsvp.counts)} · {item.rsvpNamesPublic ? s.namesPublicOn : s.namesPublicOff}
        </div>
      )}
      <div className="news-admin-actions">
        {item.status === 'pending' && (
          <Button size="small" type="link" onClick={() => onReview(item)}>
            {s.actions.review}
          </Button>
        )}
        {!isProposal && (
          <>
            <Button size="small" type="link" onClick={() => onEdit(item)}>
              {s.actions.edit}
            </Button>
            <Button size="small" type="link" onClick={() => onPatch(item, { status: isDraft ? 'published' : 'draft' }, isDraft ? s.published : s.unpublished)}>
              {isDraft ? s.actions.publish : s.actions.unpublish}
            </Button>
            <Button size="small" type="link" onClick={() => onPatch(item, { archived: !item.archived }, item.archived ? s.unarchived : s.archived)}>
              {item.archived ? s.actions.unarchive : s.actions.archive}
            </Button>
            {item.rsvpEnabled && (
              <Button size="small" type="link" onClick={() => onResponses(item)}>
                {s.actions.responses}
              </Button>
            )}
          </>
        )}
        <Popconfirm title={s.confirmDelete} okText={s.confirmYes} cancelText={s.confirmNo} onConfirm={() => onRemove(item)}>
          <Button size="small" type="link" danger>
            {s.actions.remove}
          </Button>
        </Popconfirm>
      </div>
    </div>
  )
}

// Раздел «Редактор новостей» (/modules/news, только редактор): срочная плашка, проверка предложений и списки записей.
export default function NewsAdminSection() {
  const { message } = App.useApp()
  const { me, refreshMe } = useAuth()
  const [tab, setTab] = useState('review')
  const [page, setPage] = useState(1)
  const [list, setList] = useState(null)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState(undefined) // undefined — закрыто, null — новая запись, объект — правка
  const [reviewing, setReviewing] = useState(null) // предложение в панели проверки
  const [responsesOf, setResponsesOf] = useState(null)

  const [version, setVersion] = useState(0) // растёт после изменений: список перечитывается
  // После любого изменения перечитываем список и /core/me (бейдж пункта меню — число предложений на проверке)
  const reload = () => {
    setVersion((v) => v + 1)
    refreshMe()
  }
  const pending = me.module_badges?.news ?? 0

  useEffect(() => {
    let alive = true
    api
      .get(`/modules/news/items?tab=${tab}&limit=${s.pageSize}&offset=${(page - 1) * s.pageSize}`)
      .then((result) => alive && (setList(result), setFailed(false)))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [tab, page, version])

  const act = async (request, done) => {
    try {
      await request()
      message.success(done)
      reload()
    } catch (e) {
      message.error(e.message)
    }
  }

  const changeTab = (value) => {
    setTab(value)
    setPage(1)
    setList(null)
  }

  const tabLabel = (value) => (value === 'review' && pending > 0 ? `${s.tabs.review} ${pending}` : s.tabs[value])

  return (
    <div className="news-admin">
      <h1 className="h1">{s.pageTitle}</h1>
      <section className="news-admin">
        <h3 className="h2">{s.bannerTitle}</h3>
        <BannerEditor />
      </section>
      <section className="news-admin">
        <div className="news-admin-bar">
          <Segmented aria-label={s.tabsLabel} value={tab} onChange={changeTab} options={TABS.map((value) => ({ value, label: tabLabel(value) }))} />
          <Button type="primary" onClick={() => setEditing(null)}>
            {s.add}
          </Button>
        </div>
        {failed && <Alert type="error" showIcon title={s.loadError} />}
        {!list && !failed && <Spin size="small" />}
        {list && list.items.length === 0 && <div className="news-empty">{s.empty[tab]}</div>}
        {list && list.items.length > 0 && (
          <div className="news-panel">
            {list.items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onEdit={setEditing}
                onReview={setReviewing}
                onResponses={setResponsesOf}
                onPatch={(it, body, done) => act(() => api.patch(`/modules/news/items/${it.id}`, body), done)}
                onRemove={(it) => act(() => api.post(`/modules/news/items/${it.id}/delete`), s.deleted)}
              />
            ))}
          </div>
        )}
        {list && <Pagination hideOnSinglePage showSizeChanger={false} current={page} pageSize={s.pageSize} total={list.total} onChange={setPage} />}
      </section>
      {editing !== undefined && (
        <NewsEditorDrawer
          item={editing}
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
