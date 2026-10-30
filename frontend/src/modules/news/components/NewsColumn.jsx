import { useEffect, useState } from 'react'
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons'
import { Alert, App, Button, Pagination, Popconfirm, Spin, Tag } from 'antd'
import { api } from '../../../core/api/index.js'
import { formatDateTime } from '../../../core/format.js'
import strings from '../strings.js'
import '../news.css'

const s = strings.admin
const r = strings.rsvp
const PROPOSAL_STATES = ['pending', 'needs_changes', 'rejected']

const statusOf = (item) => (item.status !== 'published' ? item.status : item.archived ? 'archived' : 'published')

// move: { up, down, onMove } — стрелки порядка у закреплённых записей вкладки «Актуальное»
function ItemRow({ item, move, onEdit, onReview, onResponses, onPatch, onRemove }) {
  const state = statusOf(item)
  const isProposal = PROPOSAL_STATES.includes(item.status)
  const isDraft = item.status === 'draft'
  return (
    <div className="news-admin-item">
      <div className="news-admin-head">
        <Tag>{s.kinds[item.kind]}</Tag>
        <Tag color={state === 'published' ? 'green' : undefined}>{s.status[state]}</Tag>
        {item.pinned && <span className="news-pin">{strings.home.pinned}</span>}
        {move && (
          <span className="news-move">
            <Button size="small" icon={<ArrowUpOutlined />} disabled={!move.up} aria-label={s.moveUp(item.title)} onClick={() => move.onMove(item, -1)} />
            <Button size="small" icon={<ArrowDownOutlined />} disabled={!move.down} aria-label={s.moveDown(item.title)} onClick={() => move.onMove(item, 1)} />
          </span>
        )}
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

// Колонка списка записей одного типа (kind) для выбранного статуса (tab): своя страница и своя пагинация.
// При смене tab родитель пересоздаёт колонку через key. version растёт после изменений — список перечитывается;
// onChanged() — родитель увеличивает version и перечитывает /core/me (бейдж «на проверке»).
export default function NewsColumn({ kind, tab, version, onEdit, onReview, onResponses, onChanged }) {
  const { message } = App.useApp()
  const [page, setPage] = useState(1)
  const [list, setList] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    api
      .get(`/modules/news/items?tab=${tab}&kind=${kind}&limit=${s.pageSize}&offset=${(page - 1) * s.pageSize}`)
      .then((result) => alive && (setList(result), setFailed(false)))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [tab, kind, page, version])

  const act = async (request, done) => {
    try {
      await request()
      message.success(done)
      onChanged()
    } catch (e) {
      message.error(e.message)
    }
  }

  // Порядок закреплённых; на сервер уходит полный список ids своего типа (колонка = один kind)
  const moveFor = (item) => {
    if (tab !== 'current' || !item.pinned) return null
    const same = list.items.filter((i) => i.pinned)
    const index = same.findIndex((i) => i.id === item.id)
    return {
      up: index > 0,
      down: index < same.length - 1,
      onMove: async (it, delta) => {
        const order = same.map((i) => i.id)
        ;[order[index], order[index + delta]] = [order[index + delta], order[index]]
        try {
          await api.post('/modules/news/pinned-order', { kind: it.kind, ids: order })
          message.success(s.moved)
        } catch (e) {
          message.error(e.message)
        }
        onChanged()
      },
    }
  }

  return (
    <>
      {failed && <Alert type="error" showIcon title={s.loadError} />}
      {!list && !failed && <Spin size="small" />}
      {list && list.items.length === 0 && <div className="news-empty">{s.empty[tab]}</div>}
      {list && list.items.length > 0 && (
        <div className="news-panel">
          {list.items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              move={moveFor(item)}
              onEdit={onEdit}
              onReview={onReview}
              onResponses={onResponses}
              onPatch={(it, body, done) => act(() => api.patch(`/modules/news/items/${it.id}`, body), done)}
              onRemove={(it) => act(() => api.post(`/modules/news/items/${it.id}/delete`), s.deleted)}
            />
          ))}
        </div>
      )}
      {list && <Pagination hideOnSinglePage showSizeChanger={false} current={page} pageSize={s.pageSize} total={list.total} onChange={setPage} />}
    </>
  )
}
