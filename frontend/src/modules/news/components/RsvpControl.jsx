import { useState } from 'react'
import { App, Segmented } from 'antd'
import { api } from '../../../core/api/index.js'
import strings from '../strings.js'

const s = strings.rsvp
const OPTIONS = ['yes', 'maybe', 'no'].map((value) => ({ value, label: s[value] }))

// Компактный выбор «Иду / Думаю / Не иду». item.rsvp.open должен быть true. onChange(updatedItem) — запись из ответа сервера.
export default function RsvpControl({ item, onChange }) {
  const { message } = App.useApp()
  const [busy, setBusy] = useState(false)

  const choose = async (answer) => {
    setBusy(true)
    try {
      onChange(await api.post(`/modules/news/items/${item.id}/rsvp`, { answer }))
    } catch (e) {
      message.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  // null, а не undefined: без ответа ни один вариант не выделен
  return <Segmented size="small" aria-label={s.label} disabled={busy} value={item.rsvp.myAnswer ?? null} options={OPTIONS} onChange={choose} />
}
