import { useEffect, useState } from 'react'
import { Alert, App, Button, Input, Space } from 'antd'
import { api } from '../../../core/api/index.js'
import { formatDateTime } from '../../../core/format.js'
import { fromLocalInput } from '../lib/news.js'
import strings from '../strings.js'
import '../news.css'

const s = strings.banner

// Панель «Срочная плашка»: текущая плашка, форма включения и кнопка «Выключить».
export default function BannerEditor() {
  const { message } = App.useApp()
  const [banner, setBanner] = useState(undefined) // undefined — грузится, null — нет плашки
  const [failed, setFailed] = useState(false)
  const [text, setText] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    api
      .get('/modules/news/banner')
      .then((result) => alive && setBanner(result.banner))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [])

  const run = async (request, done) => {
    setBusy(true)
    try {
      setBanner((await request()).banner)
      message.success(done)
    } catch (e) {
      message.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const show = () => {
    if (!text.trim()) return message.error(s.textRequired)
    return run(() => api.post('/modules/news/banner', { text, endsAt: fromLocalInput(endsAt) }), s.saved)
  }

  return (
    <div className="news-panel">
      {failed && <Alert type="error" showIcon title={s.loadError} />}
      {banner !== undefined && (
        <div className="news-note">
          {banner ? (
            `${s.current}: ${banner.text}${banner.endsAt ? ` · ${s.until(formatDateTime(banner.endsAt))}` : ''}`
          ) : (
            s.none
          )}
        </div>
      )}
      <label className="news-field">
        <span className="news-field-label">{s.fieldText}</span>
        <Input.TextArea value={text} maxLength={300} showCount autoSize={{ minRows: 2 }} onChange={(e) => setText(e.target.value)} />
      </label>
      <label className="news-field">
        <span className="news-field-label">{s.fieldEnds}</span>
        <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
      </label>
      <div className="news-field-hint">{s.hint}</div>
      <Space>
        <Button type="primary" loading={busy} onClick={show}>
          {s.show}
        </Button>
        <Button disabled={busy || !banner} onClick={() => run(() => api.post('/modules/news/banner/off'), s.switchedOff)}>
          {s.off}
        </Button>
      </Space>
    </div>
  )
}
