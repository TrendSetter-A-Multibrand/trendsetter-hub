import { useEffect, useState } from 'react'
import { Alert, Modal, Spin } from 'antd'
import { api } from '../../../core/api/index.js'
import strings from '../strings.js'
import '../news.css'

const a = strings.admin
const r = strings.rsvp
const GROUPS = ['yes', 'maybe', 'no']

// Ответы «Кто пойдёт» для редактора: счётчики и три списка имён.
export default function ResponsesModal({ item, onClose }) {
  const [names, setNames] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    api
      .get(`/modules/news/items/${item.id}/responses`)
      .then((result) => alive && setNames(result))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [item.id])

  return (
    <Modal open title={a.responsesTitle(item.title)} footer={null} onCancel={onClose}>
      {failed && <Alert type="error" showIcon title={a.responsesLoadError} />}
      {!names && !failed && <Spin size="small" />}
      {names && (
        <div className="news-who">
          {GROUPS.map((group) => (
            <div className="news-who-group" key={group}>
              <strong>{r.group(r[group], names[group].length)}</strong>
              {names[group].length === 0 ? <div className="news-note">{r.nobody}</div> : <div>{names[group].map((p) => p.name).join(', ')}</div>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
