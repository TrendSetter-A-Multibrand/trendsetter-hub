import { useState } from 'react'
import { Button, Tag } from 'antd'
import { formatDateTime } from '../../core/format.js'
import strings from './strings.js'
import FeedbackModal from './components/FeedbackModal.jsx'
import './feedback.css'

const s = strings.profile
const TAG_COLORS = { new: 'blue', in_progress: 'gold', closed: 'green' }

// Вкладка профиля «Моя обратная связь» (PROFILE_SECTIONS, id 'feedback'): только именные сообщения автора, без комментария читателя.
export default function MyFeedbackSection({ data, reload }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="fb-admin">
      <div>
        <Button type="primary" onClick={() => setOpen(true)}>
          {s.write}
        </Button>
      </div>
      {data.items.length === 0 && <div className="fb-empty">{s.empty}</div>}
      {data.items.map((item) => (
        <div className="fb-item" key={item.id}>
          <div className="fb-meta">
            <Tag>{strings.kinds[item.kind]}</Tag>
            <Tag color={TAG_COLORS[item.status]}>{strings.statuses[item.status]}</Tag>
            <span className="fb-when">{formatDateTime(item.createdAt)}</span>
            {item.recipientName && <span className="fb-when">{s.to(item.recipientName)}</span>}
          </div>
          <div className="fb-body">{item.body}</div>
        </div>
      ))}
      {open && (
        <FeedbackModal
          onClose={() => setOpen(false)}
          onSent={() => {
            setOpen(false)
            reload()
          }}
        />
      )}
    </div>
  )
}
