import { Suspense, useState } from 'react'
import { Link } from 'react-router-dom'
import { Spin } from 'antd'
import { useAuth } from '../auth/useAuth.js'
import { HOME_WIDGETS, MODULES } from '../../modules/registry.js'
import ClocksCard from '../home/ClocksCard.jsx'
import RatesCard from '../home/RatesCard.jsx'
import WeatherCard from '../home/WeatherCard.jsx'
import strings from '../strings.js'

const s = strings.hub
const h = s.home
const pad = (n) => String(n).padStart(2, '0')
const formatToday = () =>
  new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()

export default function HubPage() {
  const { me } = useAuth()
  const [hour] = useState(() => new Date().getHours())
  const [today] = useState(formatToday)

  const visibleModules = MODULES.filter((m) => !m.hidden && (me.module_access[m.id] ?? 'none') !== 'none')

  // Блоки модулей (HOME_WIDGETS): ядро не знает, чьи они; невидимые не рендерятся и запросов не делают
  // slot: 'banner' — над шапкой, 'top' — между «Моими инструментами» и сеткой, не указан — в сетку
  const widgetsOf = (slot) =>
    HOME_WIDGETS.filter((w) => (w.slot ?? null) === slot && w.visible(me)).map(({ id, Component }) => (
      <Suspense key={id} fallback={slot === 'banner' ? null : <Spin size="small" />}>
        <Component me={me} />
      </Suspense>
    ))

  const firstName = me.full_name.split(' ')[0]

  return (
    <div className="stack home">
      {widgetsOf('banner')}
      <div className="hero compact">
        <span className="corner tl">T</span>
        <span className="corner tr">R</span>
        <span className="corner bl">S</span>
        <span className="corner br">T</span>
        <div className="hero-body">
          <div className="hero-date mono">{today}</div>
          <h1>{s.greeting(firstName, hour)}</h1>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2 className="h2">{h.toolsTitle}</h2>
          <span className="counter mono">[{pad(visibleModules.length)}]</span>
        </div>
        <div className="tools-strip">
          {visibleModules.map((m) => {
            const badge = me.module_badges?.[m.id] ?? 0
            return (
              <Link key={m.id} to={`/modules/${m.id}`} className={`tool-chip${m.status === 'roadmap' ? ' dim' : ''}`}>
                <span className="tool-chip-dept mono">{m.strings.dept}</span>
                <span className="tool-chip-title">{m.strings.title}</span>
                {badge > 0 && (
                  <span className="badge mono" aria-label={strings.layout.moduleBadge(badge)}>
                    {badge}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      </section>

      {widgetsOf('top')}

      <div className="home-grid">
        <ClocksCard />
        <WeatherCard />
        <RatesCard />
        {widgetsOf(null)}
      </div>
    </div>
  )
}
