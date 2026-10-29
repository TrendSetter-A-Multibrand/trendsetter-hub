import { Suspense, useState } from 'react'
import { Spin } from 'antd'
import { useAuth } from '../auth/useAuth.js'
import { HOME_WIDGETS } from '../../modules/registry.js'
import ClocksCard from '../home/ClocksCard.jsx'
import RatesCard from '../home/RatesCard.jsx'
import WeatherCard from '../home/WeatherCard.jsx'
import strings from '../strings.js'
import mascot from '../layout/mascot.svg'
import Logo from '../layout/Logo.jsx'

const s = strings.hub
const formatToday = () => new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })

export default function HubPage() {
  const { me } = useAuth()
  const [hour] = useState(() => new Date().getHours())
  const [today] = useState(formatToday)

  // Блоки модулей (HOME_WIDGETS): ядро не знает, чьи они; невидимые не рендерятся и запросов не делают
  // slot: 'banner' — над шапкой, 'left' и 'center' — колонки новостей и событий, не указан — в правую колонку виджетов
  const widgetsOf = (slot) =>
    HOME_WIDGETS.filter((w) => (w.slot ?? null) === slot && w.visible(me)).map(({ id, Component }) => (
      <Suspense key={id} fallback={slot === 'banner' ? null : <Spin size="small" />}>
        <Component me={me} />
      </Suspense>
    ))

  // Нет доступа к новостям — колонок нет, виджеты занимают всю ширину (сеткой)
  const left = widgetsOf('left')
  const center = widgetsOf('center')
  const hasFeed = left.length > 0 || center.length > 0

  const firstName = me.full_name.split(' ')[0]
  const greeting = s.greeting(firstName, hour)

  return (
    <div className="stack home">
      {widgetsOf('banner')}
      <header className="greeting">
        <Logo className="home-logo" />
        <div className="greeting-date">{today}</div>
        <div className="greeting-row">
          <span className="greeting-mascot">
            <img src={mascot} alt="" width="52" height="52" />
          </span>
          <h1>
            {greeting.part}, <span className="accent">{greeting.name}</span>
          </h1>
        </div>
      </header>

      <div className={`home-layout${hasFeed ? ' with-feed' : ''}`}>
        {left.length > 0 && <div className="home-col">{left}</div>}
        {center.length > 0 && <div className="home-col">{center}</div>}
        <div className="home-aside">
          <ClocksCard />
          <WeatherCard />
          <RatesCard />
          {widgetsOf(null)}
        </div>
      </div>
    </div>
  )
}
