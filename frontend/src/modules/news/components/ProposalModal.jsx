import { useState } from 'react'
import { Alert, App, Button, Modal, Space } from 'antd'
import { api } from '../../../core/api/index.js'
import { initialOf, payloadOf, validate } from '../lib/news.js'
import strings from '../strings.js'
import NewsForm from './NewsForm.jsx'
import '../news.css'

const s = strings.editor

// Предложение новости автором (окно по центру). item = null — новое; запись — «Изменить» / «Отправить снова».
// onSent() вызывается после успешной отправки; ошибки сервера (422/429/409) — сообщением, окно остаётся открытым.
export default function ProposalModal({ item, onClose, onSent }) {
  const { message } = App.useApp()
  const [form, setForm] = useState(() => initialOf(item))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const send = async () => {
    const problem = validate(form)
    setError(problem)
    if (problem) return
    setBusy(true)
    try {
      const body = payloadOf(form, false)
      if (item) await api.patch(`/modules/news/proposals/${item.id}`, body)
      else await api.post('/modules/news/proposals', { ...body, kind: form.kind })
      message.success(strings.proposals.sent)
      onSent()
    } catch (e) {
      message.error(e.message)
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      centered
      width={560}
      title={item ? s.titleResubmit : s.titlePropose}
      onCancel={onClose}
      footer={
        <Space>
          <Button type="primary" loading={busy} onClick={send}>
            {item ? s.resubmit : s.submit}
          </Button>
          <Button onClick={onClose}>{s.cancel}</Button>
        </Space>
      }
    >
      {error && <Alert className="news-error" type="error" showIcon title={error} />}
      <NewsForm value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} withPinned={false} isNew={!item} />
    </Modal>
  )
}
