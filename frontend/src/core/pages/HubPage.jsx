import { Suspense, useEffect, useState } from 'react'
import { Spin } from 'antd'
import { useAuth } from '../auth/useAuth.js'
import { HOME_WIDGETS } from '../../modules/registry.js'
import ClocksCard from '../home/ClocksCard.jsx'
import RatesCard from '../home/RatesCard.jsx'
import WeatherCard from '../home/WeatherCard.jsx'
import { api } from '../api/index.js'
import { ASIDE_WIDGETS } from '../home/asideWidgets.js'
import { applyWidgetConfig } from '../home/widgetConfig.js'
import strings from '../strings.js'
import mascot from '../layout/mascot.svg'

const s = strings.hub
const formatToday = () => new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })

export default function HubPage() {
  const { me } = useAuth()
  const [hour] = useState(() => new Date().getHours())
  const [today] = useState(formatToday)
  // Настройка правой колонки (порядок и включение): undefined — грузится, null — не удалось (порядок по умолчанию)
  const [config, setConfig] = useState(undefined)

  useEffect(() => {
    let alive = true
    api
      .get('/core/home/widgets')
      .then((result) => alive && setConfig(result.widgets))
      .catch(() => alive && setConfig(null))
    return () => {
      alive = false
    }
  }, [])

  // Блоки модулей (HOME_WIDGETS): ядро не знает, чьи они; невидимые не рендерятся и запросов не делают
  // slot: 'banner' — над приветствием, 'left' — рядом с погодой (новости), 'center' — рядом с курсами (события);
  // блоки без slot — в правую колонку под курсами, через ASIDE_WIDGETS с настройкой порядка и включения
  const widgetsOf = (slot) =>
    HOME_WIDGETS.filter((w) => w.slot === slot && w.visible(me)).map(({ id, Component }) => (
      <Suspense key={id} fallback={slot === 'banner' ? null : <Spin size="small" />}>
        <Component me={me} />
      </Suspense>
    ))

  const left = widgetsOf('left')
  const center = widgetsOf('center')

  const firstName = me.full_name.split(' ')[0]
  const greeting = s.greeting(firstName, hour)

  return (
    <div className="stack home">
      {widgetsOf('banner')}
      <section className="hero" aria-label={s.greetingLabel}>
        <div className="hero-main">
          <span className="hero-tag">
            [ {strings.layout.hub} ] {today}
          </span>
          <h1 className="hero-title">
            {greeting.part}, <span className="hero-name">{greeting.name}</span>!
          </h1>
        </div>
        <ClocksCard />
        <img className="hero-mascot" src={mascot} alt="" aria-hidden="true" />
      </section>

      <div className="home-row">
        {left.length > 0 && <div className="home-main">{left}</div>}
        <div className="home-side">
          <WeatherCard />
        </div>
      </div>

      <div className="home-row">
        {center.length > 0 && <div className="home-main">{center}</div>}
        <div className="home-side">
          <RatesCard />
          {config === undefined ? (
            <Spin size="small" />
          ) : (
            applyWidgetConfig(ASIDE_WIDGETS, config)
              .filter((w) => w.visible(me))
              .map(({ id, Component }) => (
                <Suspense key={id} fallback={<Spin size="small" />}>
                  <Component me={me} />
                </Suspense>
              ))
          )}
        </div>
      </div>
    </div>
  )
}
