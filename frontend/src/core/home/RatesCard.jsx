import { useEffect, useState } from 'react'
import { Spin } from 'antd'
import { api } from '../api/index.js'
import { formatDate } from '../dates.js'
import strings from '../strings.js'
import SectionHead from '../layout/SectionHead.jsx'
import { rateRows } from './rates.js'

const s = strings.hub.home

export default function RatesCard() {
  const [state, setState] = useState({ loading: true, data: null })

  useEffect(() => {
    let alive = true
    api
      .get('/core/home/rates')
      .then((data) => alive && setState({ loading: false, data }))
      .catch(() => alive && setState({ loading: false, data: null }))
    return () => {
      alive = false
    }
  }, [])

  const rows = rateRows(state.data)
  const title = rows.length > 0 ? s.ratesTitle(formatDate(state.data.date).slice(0, 5)) : s.ratesHeading

  return (
    <section className="home-block tight" aria-labelledby="home-rates">
      <SectionHead id="home-rates" title={title} />
      {state.loading ? (
        <Spin size="small" />
      ) : rows.length === 0 ? (
        <div className="home-empty">{s.ratesUnavailable}</div>
      ) : (
        <div>
          {rows.map((r) => (
            <div className="rates-row" key={r.code} title={r.label}>
              <span className="rates-code">{r.label.split(' ').pop()}</span>
              <span className="rates-value">{r.value}</span>
              <span className={`rates-delta ${r.direction}`}>{r.delta}</span>
            </div>
          ))}
          {state.data.stale && <div className="weather-stale">{s.stale}</div>}
        </div>
      )}
    </section>
  )
}
