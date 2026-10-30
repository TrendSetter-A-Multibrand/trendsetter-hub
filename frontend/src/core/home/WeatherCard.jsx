import { Spin } from 'antd'
import strings from '../strings.js'
import SectionHead from '../layout/SectionHead.jsx'
import { dayLabel, formatTemp, weatherKind } from './weather.js'
import CityPicker from './CityPicker.jsx'

const s = strings.hub.home
const BAR_H = 88

// Неделя: полоса дня от min до max на общей шкале недели; сегодня — красная
function Week({ days }) {
  const lo = Math.min(...days.map((d) => d.min))
  const hi = Math.max(...days.map((d) => d.max))
  const span = hi - lo || 1
  const aria = s.weatherAria(days.map((d) => `${dayLabel(d.date)} ${formatTemp(d.max)}/${formatTemp(d.min)}`).join(', '))
  return (
    <div className="weather-week" role="img" aria-label={aria}>
      {days.map((d, i) => (
        <div className={`weather-day${i === 0 ? ' today' : ''}`} key={d.date}>
          <span className="weather-day-t">{formatTemp(d.max)}</span>
          <span className="weather-track">
            <span
              className="weather-bar"
              style={{
                top: Math.round(((hi - d.max) / span) * BAR_H),
                height: Math.max(6, Math.round(((d.max - d.min) / span) * BAR_H)),
              }}
            />
          </span>
          <span className="weather-day-t min">{formatTemp(d.min)}</span>
          <span className="weather-day-name">{dayLabel(d.date).split(' ')[0]}</span>
        </div>
      ))}
    </div>
  )
}

// Данные и активный город приходят из useHomeWeather (один запрос на HubPage)
export default function WeatherCard({ loading, data, cityId, onCity, myCity, onMyCity }) {
  const cities = data?.cities ?? []
  const city = cities.find((c) => c.id === cityId) ?? cities[0]
  const today = city?.days[0]
  const kind = today ? weatherKind(today.symbol) : null

  return (
    <section className="home-block" aria-labelledby="home-weather">
      <SectionHead id="home-weather" title={s.weatherTitle}>
        {cities.length > 1 && (
          <span className="seg" role="group" aria-label={s.cityLabel}>
            {cities.map((c) => (
              <button
                key={c.id}
                type="button"
                className="seg-btn"
                aria-pressed={c.id === city.id}
                onClick={() => onCity(c.id)}
              >
                {s.cities[c.id]}
              </button>
            ))}
          </span>
        )}
        <CityPicker className="weather-gear" value={myCity} onChange={onMyCity} />
      </SectionHead>
      {loading ? (
        <Spin size="small" />
      ) : !today ? (
        <div className="home-empty">{city ? s.noData : s.weatherUnavailable}</div>
      ) : (
        <>
          <div className="weather-now">
            <span className="weather-now-temp">{formatTemp(today.max)}</span>
            <span className="weather-now-sub">
              {kind ? `${s.weatherKinds[kind]} · ` : ''}
              {s.nightLabel} {formatTemp(today.min)}
            </span>
          </div>
          <Week days={city.days.slice(0, 7)} />
          {city.stale && <span className="weather-stale">{s.stale}</span>}
          <a className="weather-source" href="https://www.met.no/en" target="_blank" rel="noreferrer">
            {s.weatherSource}
          </a>
        </>
      )}
    </section>
  )
}
