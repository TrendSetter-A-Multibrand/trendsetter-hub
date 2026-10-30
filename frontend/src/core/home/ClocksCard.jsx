import { useEffect, useState } from 'react'
import strings from '../strings.js'
import { formatClock, loadClockZone, msUntilNextMinute, saveClockZone, zoneLabel } from './clocks.js'
import { clockSlots } from './myCity.js'
import ZonePicker from './ZonePicker.jsx'

const s = strings.hub.home

export default function ClocksCard({ myCity }) {
  const [now, setNow] = useState(() => new Date())
  // Сохранённые зоны двух блоков (hub.clock.1/2); null — слот следует за «моим городом»
  const [stored, setStored] = useState(() => [0, 1].map((i) => loadClockZone(window.localStorage, i)))

  // Тик по границе минуты, затем раз в 60 с; таймеры очищаются при размонтировании
  useEffect(() => {
    let interval
    const timeout = setTimeout(() => {
      setNow(new Date())
      interval = setInterval(() => setNow(new Date()), 60000)
    }, msUntilNextMinute())
    return () => {
      clearTimeout(timeout)
      clearInterval(interval)
    }
  }, [])

  // В шапке всегда два блока (TODO(Q-AP3): правило умолчаний — в clockSlots)
  const slots = clockSlots(myCity ?? null, stored, now)
  const change = (i, zone) => {
    saveClockZone(window.localStorage, i, zone)
    setStored((prev) => prev.map((z, j) => (j === i ? zone : z)))
  }

  return (
    <div className="hero-clocks" role="group" aria-label={s.clocksTitle}>
      {slots.map((z, i) => (
        <div className={`hero-clock${i === 0 ? ' prime' : ''}`} key={i}>
          <span className="hero-clock-label">
            {String(i + 1).padStart(2, '0')} · {z.cityId ? s.cities[z.cityId] : zoneLabel(z.timeZone, s.zones)}
          </span>
          <span className="hero-clock-time">{formatClock(now, z.timeZone)}</span>
          <ZonePicker className="hero-clock-gear" index={i + 1} zone={z.timeZone} onChange={(zone) => change(i, zone)} />
        </div>
      ))}
    </div>
  )
}
