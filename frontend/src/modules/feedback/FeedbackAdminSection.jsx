import { useEffect, useState } from 'react'
import { Alert, App, Button, Input, Pagination, Select, Spin, Tag } from 'antd'
import { api } from '../../core/api/index.js'
import { useAuth } from '../../core/auth/useAuth.js'
import { formatDateTime } from '../../core/format.js'
import PageHead from '../../core/layout/PageHead.jsx'
import SectionHead from '../../core/layout/SectionHead.jsx'
import { FEEDBACK_KINDS, FEEDBACK_STATUSES, NOTE_LIMIT } from './lib/feedback.js'
import strings from './strings.js'
import './feedback.css'

const s = strings.admin

// Карточка сообщения: текст выводится как обычный текст (React экранирует), переносы строк — CSS (white-space: pre-wrap).
function MessageCard({ item, onSaved }) {
  const { message } = App.useApp()
  const [status, setStatus] = useState(item.status)
  const [note, setNote] = useState(item.note ?? '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await api.patch(`/modules/feedback/messages/${item.id}`, { status, note })
      message.success(s.saved)
      onSaved()
    } catch (e) {
      message.error(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="fb-item">
      <div className="fb-meta">
        <Tag>{strings.kinds[item.kind]}</Tag>
        <span className="fb-when mono">{formatDateTime(item.createdAt)}</span>
        <span className="fb-author">{item.anonymous ? s.anonymous : item.authorName}</span>
        {item.contactOk && <Tag color="green">{s.contactOk}</Tag>}
        {item.recipientName && <span className="fb-when">{s.to(item.recipientName)}</span>}
      </div>
      <div className="fb-body">{item.body}</div>
      <div className="fb-review">
        <Select
          aria-label={s.statusLabel}
          value={status}
          onChange={setStatus}
          options={FEEDBACK_STATUSES.map((value) => ({ value, label: strings.statuses[value] }))}
        />
        <Input.TextArea
          aria-label={s.noteLabel}
          rows={2}
          maxLength={NOTE_LIMIT}
          placeholder={s.notePlaceholder}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="fb-review-actions">
          <Button type="primary" loading={busy} onClick={save}>
            {s.save}
          </Button>
          {item.updatedByName && <span className="fb-when">{s.updatedBy(item.updatedByName, formatDateTime(item.updatedAt))}</span>}
        </div>
      </div>
    </div>
  )
}

// Сообщения обратной связи (вкладка «Персонала» или запасная страница /modules/feedback, только читатель): вкладки по статусам со счётчиками, фильтр по типу, список с пагинацией.
export default function FeedbackAdminSection({ module }) {
  const { refreshMe } = useAuth()
  const [status, setStatus] = useState('new')
  const [kind, setKind] = useState(null)
  const [page, setPage] = useState(1)
  const [list, setList] = useState(null)
  const [failed, setFailed] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let alive = true
    const filter = kind ? `&kind=${kind}` : ''
    api
      .get(`/modules/feedback/messages?status=${status}${filter}&limit=${s.pageSize}&offset=${(page - 1) * s.pageSize}`)
      .then((result) => alive && (setList(result), setFailed(false)))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [status, kind, page, version])

  const reset = (apply) => {
    apply()
    setPage(1)
    setList(null)
  }
  const tabLabel = (value) => `${strings.statuses[value]}${list ? ` ${list.counts[value]}` : ''}`

  return (
    <div className="stack module feedback">
      {module && <PageHead module={module} title={module.strings.tool} />}
      <section className="fb-admin" aria-labelledby="fb-messages">
        <SectionHead id="fb-messages" title={s.pageTitle}>
          <span className="seg" role="group" aria-label={s.statusLabel}>
            {FEEDBACK_STATUSES.map((value) => (
              <button key={value} type="button" className="seg-btn" aria-pressed={status === value} onClick={() => reset(() => setStatus(value))}>
                {tabLabel(value)}
              </button>
            ))}
          </span>
        </SectionHead>
        <span className="seg" role="group" aria-label={s.kindFilterLabel}>
          {[null, ...FEEDBACK_KINDS].map((value) => (
            <button key={value ?? 'all'} type="button" className="seg-btn" aria-pressed={kind === value} onClick={() => reset(() => setKind(value))}>
              {value ? strings.kinds[value] : s.allKinds}
            </button>
          ))}
        </span>
      {failed && <Alert type="error" showIcon title={s.loadError} />}
      {!list && !failed && <Spin size="small" />}
      {list && list.items.length === 0 && <div className="fb-empty">{s.empty}</div>}
      {list?.items.map((item) => (
        <MessageCard
          key={`${item.id}-${item.updatedAt}`}
          item={item}
          onSaved={() => {
            setVersion((v) => v + 1)
            refreshMe()
          }}
        />
      ))}
      {list && <Pagination hideOnSinglePage showSizeChanger={false} current={page} pageSize={s.pageSize} total={list.total} onChange={setPage} />}
      </section>
    </div>
  )
}
