import { useEffect, useState } from 'react'
import { Alert, App, Button, Checkbox, Input, Modal, Radio, Select, Space } from 'antd'
import { api } from '../../../core/api/index.js'
import { useAuth } from '../../../core/auth/useAuth.js'
import { BODY_LIMIT, FEEDBACK_KINDS, buildPayload } from '../lib/feedback.js'
import strings from '../strings.js'
import '../feedback.css'

const s = strings.form

// Окно «Обратная связь». onSent() вызывается после успешной отправки; ошибки 422/429/503 показываются текстом сервера, окно остаётся открытым.
export default function FeedbackModal({ onClose, onSent }) {
  const { message } = App.useApp()
  const { me } = useAuth()
  const [form, setForm] = useState({ kind: 'thanks', body: '', anonymous: false, contactOk: false, recipientId: null })
  const [people, setPeople] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const patch = (values) => setForm((f) => ({ ...f, ...values }))

  useEffect(() => {
    let alive = true
    api
      .get('/modules/feedback/people')
      .then((list) => alive && setPeople(list))
      .catch(() => alive && setPeople([]))
    return () => {
      alive = false
    }
  }, [])

  const send = async () => {
    if (!form.body.trim()) {
      setError(s.bodyRequired)
      return
    }
    setError(null)
    setBusy(true)
    try {
      await api.post('/modules/feedback/messages', buildPayload(form))
      message.success(form.anonymous ? s.sentAnonymous : s.sent)
      onSent()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      centered
      width={560}
      title={s.title}
      onCancel={onClose}
      footer={
        <Space>
          <Button type="primary" loading={busy} onClick={send}>
            {s.send}
          </Button>
          <Button onClick={onClose}>{s.cancel}</Button>
        </Space>
      }
    >
      <div className="fb-form">
        {error && <Alert type="error" showIcon title={error} />}
        <div className="fb-field">
          <span className="fb-label">{s.kindLabel}</span>
          <Radio.Group
            className="card-options"
            aria-label={s.kindLabel}
            value={form.kind}
            onChange={(e) => patch({ kind: e.target.value, recipientId: e.target.value === 'thanks' ? form.recipientId : null })}
            options={FEEDBACK_KINDS.map((value) => ({ value, label: strings.kinds[value] }))}
          />
        </div>
        {form.kind === 'thanks' && (
          <div className="fb-field">
            <span className="fb-label">{s.recipientLabel}</span>
            <Select
              showSearch
              allowClear
              placeholder={s.recipientPlaceholder}
              value={form.recipientId}
              onChange={(recipientId) => patch({ recipientId: recipientId ?? null })}
              optionFilterProp="label"
              options={people.map((p) => ({ value: p.id, label: p.fullName }))}
            />
          </div>
        )}
        <div className="fb-field">
          <span className="fb-label">{s.bodyLabel}</span>
          <Input.TextArea
            aria-label={s.bodyLabel}
            rows={6}
            maxLength={BODY_LIMIT}
            placeholder={s.bodyPlaceholder}
            value={form.body}
            onChange={(e) => patch({ body: e.target.value })}
          />
          <span className="fb-counter">{s.counter(form.body.length, BODY_LIMIT)}</span>
        </div>
        <Checkbox checked={form.anonymous} onChange={(e) => patch({ anonymous: e.target.checked, contactOk: false })}>
          {s.anonymous}
        </Checkbox>
        {form.anonymous ? (
          <Alert type="warning" showIcon title={s.anonymousWarning} />
        ) : (
          <>
            <div className="fb-hint">{s.from(me.full_name)}</div>
            <Checkbox checked={form.contactOk} onChange={(e) => patch({ contactOk: e.target.checked })}>
              {s.contactOk}
            </Checkbox>
            <div className="fb-hint">{s.namedHint}</div>
          </>
        )}
      </div>
    </Modal>
  )
}
