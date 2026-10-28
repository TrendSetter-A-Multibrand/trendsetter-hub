import { useEffect, useState } from 'react'
import { Spin } from 'antd'
import { api } from '../api/index.js'
import strings from '../strings.js'
import { dayLabel, formatTemp, weatherKind } from './weather.js'

const s = strings.hub.home

function CityRow({ city }) {
  return (
    <div className="weather-city">
      <div className="weather-city-head">
        <span className="weather-city-name">{s.cities[city.id]}</span>
        {city.stale && <span className="weather-stale">{s.stale}</span>}
      </div>
      {city.days.length === 0 ? (
        <div className="weather-empty">{s.noData}</div>
      ) : (
        <div className="weather-days">
          {city.days.map((d) => {
            const kind = weatherKind(d.symbol)
            return (
              <div className="weather-day" key={d.date}>
                <span className="weather-date mono">{dayLabel(d.date)}</span>
                <span className="weather-max">{formatTemp(d.max)}</span>
                <span className="weather-min">{formatTemp(d.min)}</span>
                <span className="weather-kind">{kind ? s.weatherKinds[kind] : ''}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function WeatherCard() {
  const [state, setState] = useState({ loading: true, data: null })

  useEffect(() => {
    let alive = true
    api
      .get('/core/home/weather')
      .then((data) => alive && setState({ loading: false, data }))
      .catch(() => alive && setState({ loading: false, data: null }))
    return () => {
      alive = false
    }
  }, [])

  const cities = state.data?.cities ?? []
  const available = cities.some((c) => c.days.length > 0)

  return (
    <section className="home-card">
      <div className="home-card-head">{s.weatherTitle}</div>
      {state.loading ? (
        <Spin size="small" />
      ) : !available ? (
        <div className="weather-empty">{s.weatherUnavailable}</div>
      ) : (
        <>
          {cities.map((c) => (
            <CityRow city={c} key={c.id} />
          ))}
          <a className="weather-source" href="https://www.met.no/en" target="_blank" rel="noreferrer">
            {s.weatherSource}
          </a>
        </>
      )}
    </section>
  )
}
