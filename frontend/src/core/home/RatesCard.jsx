import { useEffect, useState } from 'react'
import { Spin } from 'antd'
import { api } from '../api/index.js'
import { formatDate } from '../dates.js'
import strings from '../strings.js'
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

  return (
    <section className="home-card">
      <div className="home-card-head">{rows.length > 0 ? s.ratesTitle(formatDate(state.data.date)) : s.ratesHeading}</div>
      {state.loading ? (
        <Spin size="small" />
      ) : rows.length === 0 ? (
        <div className="weather-empty">{s.ratesUnavailable}</div>
      ) : (
        <>
          {rows.map((r) => (
            <div className="rates-row" key={r.code}>
              <span className="rates-value">
                {r.label} = {r.value}
              </span>
              <span className={`rates-delta mono ${r.direction}`}>{r.delta}</span>
            </div>
          ))}
          {state.data.stale && <div className="weather-stale">{s.stale}</div>}
        </>
      )}
    </section>
  )
}
