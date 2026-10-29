import { useEffect, useState } from 'react'
import { Spin } from 'antd'
import { api } from '../../../core/api/index.js'
import { addDays } from '../../../core/dates.js'
import SectionHead from '../../../core/layout/SectionHead.jsx'
import { COUNTRIES, formatPeriod, indexDays, restPeriods, todayIn } from '../lib/holidays.js'
import strings from '../strings.js'
import CalendarModal from './CalendarModal.jsx'
import '../holidays.css'

const s = strings.home
const HORIZON = 365

// Блок главной (HOME_WIDGETS): ближайшие периоды отдыха отдельно для Армении и России + кнопка с календарём за год.
// Один запрос: от меньшей из сегодняшних дат двух стран на год вперёд; «сегодня» считается в часовом поясе страны.
export default function HomeHolidays() {
  const [now] = useState(() => new Date())
  const [state, setState] = useState({ rows: null, error: false })
  const [open, setOpen] = useState(false)
  const todays = COUNTRIES.map((c) => todayIn(c.timezone, now))
  const start = [...todays].sort()[0]

  useEffect(() => {
    let alive = true
    api
      .get(`/modules/holidays/days?start=${start}&end=${addDays(start, HORIZON + 1)}`)
      .then((result) => alive && setState({ rows: result.days, error: false }))
      .catch(() => alive && setState({ rows: null, error: true }))
    return () => {
      alive = false
    }
  }, [start])

  const index = state.rows ? indexDays(state.rows) : null

  return (
    <section className="home-block tight" aria-labelledby="home-holidays">
      <SectionHead id="home-holidays" title={s.title}>
        <button type="button" className="sec-link mono-label hc-home-open" onClick={() => setOpen(true)}>
          {s.calendarLink}
        </button>
      </SectionHead>
      {state.error ? (
        <div className="people-empty">{s.loadError}</div>
      ) : !index ? (
        <Spin size="small" />
      ) : (
        COUNTRIES.map((c, i) => {
          const periods = restPeriods(index[c.id], todays[i], { horizon: HORIZON })
          return (
            <div className="hc-home-country" key={c.id}>
              <div className="hc-home-country-name mono-label">{strings.countries[c.id]}</div>
              {periods.length === 0 && <div className="people-empty">{s.empty}</div>}
              {periods.map((p) => (
                <div className="people-row hc-home-row" key={p.start}>
                  <span className="hc-home-when mono">{formatPeriod(p.start, p.end)}</span>
                  <span className="hc-home-name">
                    {p.names.join(', ') || s.fallbackName}
                    {p.now && <span className="hc-now">{s.now}</span>}
                  </span>
                  <span className="hc-home-days mono" title={s.days(p.days)}>
                    {s.daysShort(p.days)}
                  </span>
                </div>
              ))}
            </div>
          )
        })
      )}
      {open && <CalendarModal onClose={() => setOpen(false)} />}
    </section>
  )
}
