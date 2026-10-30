import { useEffect, useState } from 'react'
import strings from '../strings.js'
import { formatClock, msUntilNextMinute } from './clocks.js'
import { clockZones } from './myCity.js'
import CityPicker from './CityPicker.jsx'

const s = strings.hub.home

export default function ClocksCard({ myCity, onMyCity }) {
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

  // В шапке всегда два блока: без «моего города» — Ереван и Москва (TODO(Q-P2): правило второго блока — в clockZones)
  const zones = clockZones(myCity ?? null, now)

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
      {onMyCity && <CityPicker className="hero-clocks-gear" value={myCity} onChange={onMyCity} />}
    </div>
  )
}
