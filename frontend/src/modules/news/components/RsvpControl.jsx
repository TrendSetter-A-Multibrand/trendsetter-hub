import { useState } from 'react'
import { App } from 'antd'
import { api } from '../../../core/api/index.js'
import strings from '../strings.js'
import '../news.css'

const s = strings.rsvp
const ANSWERS = ['yes', 'maybe', 'no']

// Три кнопки «Иду / Думаю / Не иду» в ряд на всю ширину. item.rsvp.open должен быть true. onChange(updatedItem) — запись из ответа сервера.
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

  // Без ответа ни одна кнопка не нажата; цвет выбранной — насыщенный (news.css)
  return (
    <div className="rsvp-buttons" role="group" aria-label={s.label}>
      {ANSWERS.map((answer) => (
        <button
          key={answer}
          type="button"
          className={`rsvp-btn ${answer}`}
          aria-pressed={item.rsvp.myAnswer === answer}
          disabled={busy}
          onClick={() => choose(answer)}
        >
          {s[answer]}
        </button>
      ))}
    </div>
  )
}
