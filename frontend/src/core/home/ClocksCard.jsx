import { useEffect, useState } from 'react'
import strings from '../strings.js'
import { CLOCK_ZONES, formatClock, msUntilNextMinute } from './clocks.js'

const s = strings.hub.home

export default function ClocksCard() {
  const [now, setNow] = useState(() => new Date())

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

  // В шапке главной — только два города (остальные решения демо-витрины не требуют): Ереван и Москва
  const zones = CLOCK_ZONES.slice(0, 2)

  return (
    <div className="hero-clocks" role="group" aria-label={s.clocksTitle}>
      {zones.map((z, i) => (
        <div className={`hero-clock${i === 0 ? ' prime' : ''}`} key={z.id}>
          <span className="hero-clock-label">
            {String(i + 1).padStart(2, '0')} · {s.cities[z.id]}
          </span>
          <span className="hero-clock-time">{formatClock(now, z.timeZone)}</span>
        </div>
      ))}
    </div>
  )
}
