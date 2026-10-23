import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Popover, Spin } from 'antd'
import { BellOutlined } from '@ant-design/icons'
import { api } from '../api/index.js'
import { useAuth } from '../auth/useAuth.js'
import { formatDateTime } from '../format.js'
import strings from '../strings.js'

const s = strings.notifications

function List({ items, error, onOpen }) {
  if (error) return <div style={{ color: 'var(--red)' }}>{error}</div>
  if (items === null) return <Spin />
  if (items.length === 0) return <div style={{ color: 'var(--muted)' }}>{s.empty}</div>
  return (
    <div className="notif-list">
      {items.map((n) => (
        <button type="button" key={n.id} className={`notif-item${n.read ? '' : ' unread'}`} onClick={() => onOpen(n)}>
          <span className="notif-title">{n.title}</span>
          <span className="notif-body">{n.body}</span>
          <span className="notif-date mono">{formatDateTime(n.createdAt)}</span>
        </button>
      ))}
    </div>
  )
}

// Колокольчик в сайдбаре: счётчик берётся из me.unread_notifications (его обновляет syncMe раз в ~60 с),
// список загружается при открытии и перечитывается, пока открыт и счётчик меняется.
export default function NotificationsBell() {
  const { me, syncMe } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const unread = me.unread_notifications ?? 0

  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!open) return undefined
    let alive = true
    api
      .get('/core/notifications?limit=30')
      .then((list) => {
        if (!alive) return
        setItems(list)
        setError(null)
      })
      .catch((e) => alive && setError(e.message || s.loadFailed))
    return () => {
      alive = false
    }
  }, [open, unread, tick])

  const markRead = async (ids) => {
    try {
      await api.post('/core/notifications/read', { ids })
      refresh()
      await syncMe()
    } catch (e) {
      setError(e.message || s.loadFailed)
    }
  }

  const openItem = async (n) => {
    if (!n.read) await markRead([n.id])
    setOpen(false)
    if (n.link) navigate(n.link)
  }

  const content = (
    <div className="notif-panel">
      <div className="notif-head">
        <strong>{s.title}</strong>
        <Button size="small" type="link" disabled={unread === 0} onClick={() => markRead(null)}>
          {s.markAll}
        </Button>
      </div>
      <List items={items} error={error} onOpen={openItem} />
    </div>
  )

  return (
    <Popover content={content} trigger="click" placement="topLeft" open={open} onOpenChange={setOpen} arrow={false}>
      <button type="button" className="icon-btn" aria-label={unread > 0 ? `${s.open}. ${s.unread(unread)}` : s.open}>
        <BellOutlined />
        {unread > 0 && <span className="icon-badge mono">{unread > 99 ? '99+' : unread}</span>}
      </button>
    </Popover>
  )
}
