import { useEffect, useState } from 'react'
import { Alert, App, Button, Pagination, Popconfirm, Segmented, Spin, Tag } from 'antd'
import { api } from '../../core/api/index.js'
import { formatDateTime } from '../../core/format.js'
import strings from './strings.js'
import BannerEditor from './components/BannerEditor.jsx'
import NewsEditorDrawer from './components/NewsEditorDrawer.jsx'
import ResponsesModal from './components/ResponsesModal.jsx'
import './news.css'

const s = strings.admin
const r = strings.rsvp
const TABS = ['current', 'past', 'drafts']

const statusOf = (item) => (item.status === 'draft' ? 'draft' : item.archived ? 'archived' : 'published')

function ItemRow({ item, onEdit, onResponses, onPatch, onRemove }) {
  const state = statusOf(item)
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
      {item.rsvp && (
        <div className="news-counts">
          {r.counts(item.rsvp.counts)} · {item.rsvpNamesPublic ? s.namesPublicOn : s.namesPublicOff}
        </div>
      )}
      <div className="news-admin-actions">
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
        <Popconfirm title={s.confirmDelete} okText={s.confirmYes} cancelText={s.confirmNo} onConfirm={() => onRemove(item)}>
          <Button size="small" type="link" danger>
            {s.actions.remove}
          </Button>
        </Popconfirm>
      </div>
    </div>
  )
}

// Вкладка «Новости» профиля (PROFILE_SECTIONS, только редактор): срочная плашка и списки записей.
export default function NewsAdminSection() {
  const { message } = App.useApp()
  const [tab, setTab] = useState('current')
  const [page, setPage] = useState(1)
  const [list, setList] = useState(null)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState(undefined) // undefined — закрыто, null — новая запись, объект — правка
  const [responsesOf, setResponsesOf] = useState(null)

  const [version, setVersion] = useState(0) // растёт после изменений: список перечитывается
  const reload = () => setVersion((v) => v + 1)

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

  return (
    <div className="news-admin">
      <section className="news-admin">
        <h3 className="h2">{s.bannerTitle}</h3>
        <BannerEditor />
      </section>
      <section className="news-admin">
        <div className="news-admin-bar">
          <Segmented aria-label={s.tabsLabel} value={tab} onChange={changeTab} options={TABS.map((value) => ({ value, label: s.tabs[value] }))} />
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
      {responsesOf && <ResponsesModal item={responsesOf} onClose={() => setResponsesOf(null)} />}
    </div>
  )
}
