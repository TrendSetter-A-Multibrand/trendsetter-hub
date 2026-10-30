import { useState } from 'react'
import { Alert, App, Button, Drawer, Input, Modal, Space } from 'antd'
import { api } from '../../../core/api/index.js'
import { formatDateTime } from '../../../core/format.js'
import { initialOf, payloadOf, validate } from '../lib/news.js'
import strings from '../strings.js'
import NewsForm from './NewsForm.jsx'
import '../news.css'

const s = strings.editor

// Окно решения «Вернуть на доработку» / «Отклонить»: комментарий автору обязателен (1..1000 символов).
function DecisionModal({ title, okText, busy, onOk, onCancel }) {
  const [comment, setComment] = useState('')
  const [error, setError] = useState(null)
  const submit = () => {
    if (!comment.trim()) return setError(s.commentRequired)
    setError(null)
    onOk(comment.trim())
  }
  return (
    <Modal
      open
      centered
      title={title}
      okText={okText}
      cancelText={s.cancel}
      confirmLoading={busy}
      onOk={submit}
      onCancel={onCancel}
    >
      {error && <Alert className="news-error" type="error" showIcon title={error} />}
      <label className="news-field">
        <span className="news-field-label">{s.commentLabel}</span>
        <Input.TextArea value={comment} maxLength={1000} showCount autoSize={{ minRows: 3, maxRows: 8 }} onChange={(e) => setComment(e.target.value)} />
      </label>
    </Modal>
  )
}

// defaultKind — тип новой записи по умолчанию (только при item === null); выбор типа в форме остаётся.
// Создание и правка записи (mode 'edit', item — null для новой) и проверка предложения (mode 'review', item — запись в pending).
// onSaved() вызывается после успешного сохранения или решения, а также после 409 (запись изменилась): список надо перечитать.
export default function NewsEditorDrawer({ item, mode = 'edit', defaultKind, onClose, onSaved }) {
  const { message } = App.useApp()
  const [form, setForm] = useState(() => (item || !defaultKind ? initialOf(item) : { ...initialOf(null), kind: defaultKind }))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [decision, setDecision] = useState(null) // 'return' | 'reject' | null
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const review = mode === 'review'
  const published = item?.status === 'published'

  const save = async (publish) => {
    const problem = validate(form)
    setError(problem)
    if (problem) return
    setBusy(true)
    try {
      const body = payloadOf(form)
      if (item) await api.patch(`/modules/news/items/${item.id}`, publish ? { ...body, status: 'published' } : body)
      else await api.post('/modules/news/items', { ...body, kind: form.kind, status: publish ? 'published' : 'draft' })
      message.success(s.saved)
      onSaved()
    } catch (e) {
      message.error(e.message)
      setBusy(false)
    }
  }

  // Режим review: ошибка 409 — запись изменилась или уже рассмотрена: сообщение, закрыть панель, перечитать список
  const reviewRequest = async (request, done) => {
    setBusy(true)
    try {
      await request()
      message.success(done)
      onSaved()
    } catch (e) {
      message.error(e.message)
      if (e.status === 409) onSaved()
      else setBusy(false)
    }
  }

  // «Поправить и опубликовать»: PATCH содержимого (без status/archived), если форма менялась, затем approve с updatedAt из ответа
  const approve = () => {
    const problem = validate(form)
    setError(problem)
    if (problem) return
    reviewRequest(async () => {
      const body = payloadOf(form)
      const changed = JSON.stringify(body) !== JSON.stringify(payloadOf(initialOf(item)))
      const current = changed ? await api.patch(`/modules/news/items/${item.id}`, body) : item
      await api.post(`/modules/news/items/${item.id}/approve`, { expectedUpdatedAt: current.updatedAt })
    }, strings.admin.published)
  }

  const decide = (action, comment) =>
    reviewRequest(() => api.post(`/modules/news/items/${item.id}/${action}`, { comment, expectedUpdatedAt: item.updatedAt }), strings.admin.reviewed)

  const footer = review ? (
    <Space wrap>
      <Button type="primary" loading={busy} onClick={approve}>
        {s.approve}
      </Button>
      <Button loading={busy} onClick={() => setDecision('return')}>
        {s.return}
      </Button>
      <Button danger loading={busy} onClick={() => setDecision('reject')}>
        {s.reject}
      </Button>
      <Button onClick={onClose}>{s.cancel}</Button>
    </Space>
  ) : (
    <Space>
      {published ? (
        <Button type="primary" loading={busy} onClick={() => save(false)}>
          {s.save}
        </Button>
      ) : (
        <>
          <Button type="primary" loading={busy} onClick={() => save(true)}>
            {s.publish}
          </Button>
          <Button loading={busy} onClick={() => save(false)}>
            {s.saveDraft}
          </Button>
        </>
      )}
      <Button onClick={onClose}>{s.cancel}</Button>
    </Space>
  )

  return (
    <Drawer open size={560} title={review ? s.titleReview : item ? s.titleEdit : s.titleCreate} onClose={onClose} footer={footer}>
      {error && <Alert className="news-error" type="error" showIcon title={error} />}
      {review && item.review && (
        <div className="news-field">
          <span className="news-field-label">
            {item.review.author ? strings.admin.author(item.review.author.name) : strings.admin.authorDeleted} · {strings.admin.sentAt(formatDateTime(item.review.submittedAt))}
          </span>
          {item.review.reviewComment && <span className="news-field-hint">{strings.admin.comment(item.review.reviewComment)}</span>}
        </div>
      )}
      <NewsForm value={form} onChange={set} withPinned isNew={!item} />
      {decision && (
        <DecisionModal
          title={decision === 'return' ? s.returnTitle : s.rejectTitle}
          okText={decision === 'return' ? s.return : s.reject}
          busy={busy}
          onOk={(comment) => decide(decision, comment)}
          onCancel={() => setDecision(null)}
        />
      )}
    </Drawer>
  )
}
