import { useState } from 'react'
import strings from '../strings.js'
import FeedbackModal from './FeedbackModal.jsx'

// Кнопка верхней строки (TOPLINE_ACTIONS): открывает окно обратной связи.
export default function FeedbackButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="topline-btn" onClick={() => setOpen(true)}>
        {strings.title}
      </button>
      {open && <FeedbackModal onClose={() => setOpen(false)} onSent={() => setOpen(false)} />}
    </>
  )
}
