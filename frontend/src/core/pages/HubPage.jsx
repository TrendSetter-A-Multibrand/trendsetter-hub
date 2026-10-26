import { Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Spin } from 'antd'
import { api } from '../api/index.js'
import { canSeeData } from '../access.js'
import { formatDateTime } from '../format.js'
import { useAuth } from '../auth/useAuth.js'
import { HOME_WIDGETS, MODULES, getModule } from '../../modules/registry.js'
import ClocksCard from '../home/ClocksCard.jsx'
import RatesCard from '../home/RatesCard.jsx'
import WeatherCard from '../home/WeatherCard.jsx'
import strings from '../strings.js'

const s = strings.hub
const h = s.home
const pad = (n) => String(n).padStart(2, '0')
const formatToday = () =>
  new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()

function RecentRuns({ runs, error }) {
  if (error) return <Alert type="error" showIcon title={error} />
  if (runs === null) return <Spin />
  return (
    <div className="runs compact">
      {runs.length === 0 && <div style={{ padding: 20, color: 'var(--muted)' }}>{s.noRuns}</div>}
      {runs.map((run) => {
        const status = strings.runStatuses[run.status]
        const module = getModule(run.module_id)
        return (
          <div className="run-row" key={run.id}>
            <span className="run-dept mono">{module?.strings.dept ?? run.module_id}</span>
            <div className="run-main">
              <span className="run-file">{run.filename}</span>
              <span className="run-who">{run.user_name}</span>
            </div>
            <span className="run-date mono">{formatDateTime(run.created_at)}</span>
            <span className="status-pill mono" style={{ background: status.bg, color: status.fg }}>
              <span className="status-square" style={{ background: status.fg }} />
              {status.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function HubPage() {
  const { me } = useAuth()
  const [runs, setRuns] = useState(null)
  const [runsError, setRunsError] = useState(null)
  const [hour] = useState(() => new Date().getHours())
  const [today] = useState(formatToday)

  const visibleModules = MODULES.filter((m) => (me.module_access[m.id] ?? 'none') !== 'none')
  const hasData = visibleModules.some((m) => canSeeData(me.module_access[m.id]))

  useEffect(() => {
    if (!hasData) return
    api
      .get('/core/runs?limit=5')
      .then(setRuns)
      .catch((e) => setRunsError(e.message))
  }, [hasData, me.id, me.access_level])

  // Блоки модулей (HOME_WIDGETS): ядро не знает, чьи они; невидимые не рендерятся и запросов не делают
  const widgetsOf = (area) =>
    HOME_WIDGETS.filter((w) => w.area === area && w.visible(me)).map(({ id, Component }) => (
      <Suspense key={id} fallback={<Spin size="small" />}>
        <Component me={me} />
      </Suspense>
    ))

  const firstName = me.full_name.split(' ')[0]

  return (
    <div className="stack">
      <div className="hero">
        <span className="corner tl">T</span>
        <span className="corner tr">R</span>
        <span className="corner bl">S</span>
        <span className="corner br">T</span>
        <div className="hero-body">
          <div className="hero-date mono">{today}</div>
          <h1>{s.greeting(firstName, hour)}</h1>
          <div className="hero-sub mono">{s.subtitle}</div>
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

      <div className="home-grid">
        <div className="home-col main">
          <WeatherCard />
          {widgetsOf('main')}
          {hasData && (
            <section className="section">
              <div className="section-head split">
                <h2 className="h2">{s.recentRuns}</h2>
                <Link to="/modules/purchasing" className="link-mono mono">
                  {s.allRuns} →
                </Link>
              </div>
              <RecentRuns runs={runs} error={runsError} />
            </section>
          )}
        </div>
        <div className="home-col side">
          <ClocksCard />
          <RatesCard />
          {widgetsOf('side')}
        </div>
      </div>
    </div>
  )
}
