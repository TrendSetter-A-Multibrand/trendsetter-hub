import { useEffect, useState } from 'react'
import { Alert, App, Button, Spin, Switch } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons'
import { api } from '../../../core/api/index.js'
import { ASIDE_WIDGETS } from '../../../core/home/asideWidgets.js'
import SectionHead from '../../../core/layout/SectionHead.jsx'
import { orderWidgets } from '../../../core/home/widgetConfig.js'
import strings from '../strings.js'
import '../news.css'

const s = strings.widgets

// Панель «Виджеты главной»: порядок и включение виджетов правой колонки (одна настройка на всех). Выключенные тоже видны.
export default function HomeWidgetsEditor() {
  const { message } = App.useApp()
  const [list, setList] = useState(null) // [{ id, label, enabled }] в текущем порядке
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  const fromConfig = (config) => orderWidgets(ASIDE_WIDGETS, config).map(({ id, label, enabled }) => ({ id, label, enabled }))

  useEffect(() => {
    let alive = true
    api
      .get('/core/home/widgets')
      .then((result) => alive && setList(fromConfig(result.widgets)))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [])

  const move = (index, delta) =>
    setList((l) => {
      const next = [...l]
      ;[next[index], next[index + delta]] = [next[index + delta], next[index]]
      return next
    })
  const toggle = (index, enabled) => setList((l) => l.map((w, i) => (i === index ? { ...w, enabled } : w)))

  const save = async () => {
    setBusy(true)
    try {
      const result = await api.post('/core/home/widgets', { widgets: list.map(({ id, enabled }) => ({ id, enabled })) })
      setList(fromConfig(result.widgets))
      message.success(s.saved)
    } catch (e) {
      message.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="news-admin">
      <SectionHead id="news-widgets" title={s.title}>
        <span className="sec-note mono-label">{s.fixedNote}</span>
      </SectionHead>
      <div className="news-hint">{s.hint}</div>
      {failed && <Alert type="error" showIcon title={s.loadError} />}
      {!list && !failed && <Spin size="small" />}
      {list && (
        <>
          {list.map((w, i) => (
            <div key={w.id} className="people-row widget-row">
              <span className="widget-label">{w.label}</span>
              <Switch checked={w.enabled} onChange={(value) => toggle(i, value)} aria-label={`${s.show}: ${w.label}`} />
              <Button size="small" icon={<ArrowUpOutlined />} disabled={i === 0} aria-label={s.up(w.label)} onClick={() => move(i, -1)} />
              <Button size="small" icon={<ArrowDownOutlined />} disabled={i === list.length - 1} aria-label={s.down(w.label)} onClick={() => move(i, 1)} />
            </div>
          ))}
          <div className="news-save">
            <Button type="primary" loading={busy} onClick={save}>
              {s.save}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
