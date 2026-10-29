import { useState } from 'react'
import { Button, Tag } from 'antd'
import { formatDateTime } from '../../core/format.js'
import strings from './strings.js'
import ProposalModal from './components/ProposalModal.jsx'
import './news.css'

const s = strings.proposals
const TAG_COLORS = { pending: 'gold', needs_changes: 'orange', published: 'green', rejected: 'red' }

const statusOf = (item) => (item.status === 'published' && item.archived ? 'archived' : item.status)

// Вкладка профиля «Мои предложения» (PROFILE_SECTIONS, id 'proposals'): свои предложения со статусами и комментарием редактора.
export default function MyProposalsSection({ data, reload }) {
  const [editing, setEditing] = useState(undefined) // undefined — закрыто, null — новое, объект — доработка

  const modal = editing !== undefined && (
    <ProposalModal
      item={editing}
      onClose={() => setEditing(undefined)}
      onSent={() => {
        setEditing(undefined)
        reload()
      }}
    />
  )

  return (
    <div className="news-admin">
      {data.items.length === 0 && <div className="news-empty">{s.empty}</div>}
      <div>
        <Button type="primary" onClick={() => setEditing(null)}>
          {s.propose}
        </Button>
      </div>
      {data.items.length > 0 && (
        <div className="news-panel">
          {data.items.map((item) => {
            const state = statusOf(item)
            const open = item.status === 'needs_changes' || item.status === 'rejected'
            return (
              <div className="news-admin-item" key={item.id}>
                <div className="news-admin-head">
                  <Tag>{strings.admin.kinds[item.kind]}</Tag>
                  <Tag color={TAG_COLORS[state]}>{s.status[state]}</Tag>
                  <span className="news-admin-title">{item.title}</span>
                </div>
                <div className="news-when mono">{s.sentAt(formatDateTime(item.review.submittedAt))}</div>
                {open && item.review.reviewComment && (
                  <div className="news-note">
                    {s.comment}: {item.review.reviewComment}
                  </div>
                )}
                {(item.status === 'pending' || open) && (
                  <div className="news-admin-actions">
                    <Button size="small" type="link" onClick={() => setEditing(item)}>
                      {item.status === 'pending' ? s.edit : s.resubmit}
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {modal}
    </div>
  )
}
