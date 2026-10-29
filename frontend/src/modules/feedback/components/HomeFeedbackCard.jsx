import { useState } from 'react'
import { Button } from 'antd'
import SectionHead from '../../../core/layout/SectionHead.jsx'
import strings from '../strings.js'
import FeedbackModal from './FeedbackModal.jsx'
import '../feedback.css'

const s = strings.home

// Блок главной (HOME_WIDGETS, правая колонка): подпись и кнопка «Написать», открывающая окно обратной связи.
export default function HomeFeedbackCard() {
  const [open, setOpen] = useState(false)
  return (
    <section className="home-block tight" aria-labelledby="home-feedback">
      <SectionHead id="home-feedback" title={s.title} />
      <div className="fb-hint">{s.text}</div>
      <div className="fb-card-action">
        <Button type="primary" onClick={() => setOpen(true)}>
          {s.write}
        </Button>
      </div>
      {open && <FeedbackModal onClose={() => setOpen(false)} onSent={() => setOpen(false)} />}
    </section>
  )
}
