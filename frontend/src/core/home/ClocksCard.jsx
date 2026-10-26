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

  return (
    <section className="home-card">
      <div className="home-card-head mono">{s.clocksTitle}</div>
      <div className="clocks">
        {CLOCK_ZONES.map((z) => (
          <div className="clock" key={z.id}>
            <span className="clock-city mono">{s.cities[z.id]}</span>
            <span className="clock-time">{formatClock(now, z.timeZone)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
