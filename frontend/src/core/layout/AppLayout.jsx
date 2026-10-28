import { Link, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'
import { DEMO_MODE } from '../config.js'
import { MODULES } from '../../modules/registry.js'
import strings from '../strings.js'
import DemoUserSwitcher from './DemoUserSwitcher.jsx'
import NotificationsBell from './NotificationsBell.jsx'

const s = strings.layout

const initials = (fullName) =>
  fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

export default function AppLayout() {
  const { me } = useAuth()
  const location = useLocation()

  // Все модули, кроме скрытых (hidden), остаются в меню; недоступные открываются заглушкой «Нет доступа» (ModulePage)
  const navModules = MODULES.filter((m) => !m.hidden).map((m, i) => ({
    ...m,
    idx: String(i + 1).padStart(2, '0'),
    allowed: (me.module_access[m.id] ?? 'none') !== 'none',
  }))

  const wide = Boolean(navModules.find((m) => m.allowed && m.wide && location.pathname === `/modules/${m.id}`))

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Link to="/">{strings.brand}</Link>
          <div className="brand-sub mono">{strings.brandSub}</div>
        </div>
        <nav aria-label={strings.mainNav}>
          <Link to="/" className={`nav-item live${location.pathname === '/' ? ' active' : ''}`}>
            <span className="nav-dot" />
            <span className="nav-title bracket">{s.home}</span>
          </Link>
          <div className="nav-label mono">{s.departmentsLabel}</div>
          <div className="nav-list">
            {navModules.map((m) => {
              const path = `/modules/${m.id}`
              const active = location.pathname === path
              const badge = me.module_badges?.[m.id] ?? 0
              const link = (
                <Link key={m.id} to={path} className={`nav-item${m.Component && m.allowed ? ' live' : ' dim'}${active ? ' active' : ''}`}>
                  <span className="nav-dot" />
                  <span className="nav-text">
                    <span className="nav-title bracket">{m.strings.tool}</span>
                    <span className="nav-dept mono">{m.strings.dept}</span>
                  </span>
                  {badge > 0 && (
                    <span className="nav-badge mono" aria-label={s.moduleBadge(badge)}>
                      {badge}
                    </span>
                  )}
                  <span className="nav-idx mono">{m.idx}</span>
                </Link>
              )
              // разделы модуля (sections в реестре) — раскрываются под пунктом при наведении и на странице модуля
              if (!m.sections || !m.allowed || !m.Component) return link
              const current = new URLSearchParams(location.search).get('section') ?? m.sections[0].key
              return (
                <div key={m.id} className={`nav-group${active ? ' open' : ''}`}>
                  {link}
                  <div className="nav-sections">
                    {m.sections.map((sec) => (
                      <Link
                        key={sec.key}
                        to={`${path}?section=${sec.key}`}
                        className={`nav-section${active && current === sec.key ? ' active' : ''}`}
                      >
                        <span className="bracket">{sec.label}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </nav>
        <div className="user-slot">
          <div className="user-box">
            <Link to="/profile" className="user-link" aria-label={s.openProfile}>
              <div className="user-avatar mono">{initials(me.full_name)}</div>
              <div className="user-text">
                <span className="user-name">{me.full_name}</span>
                <span className="user-role mono">{strings.levels[me.access_level]}</span>
              </div>
            </Link>
            <NotificationsBell />
          </div>
        </div>
      </aside>

      <main className="main">
        {DEMO_MODE && (
          <div className="demo-banner">
            <span className="dot" />
            <span className="mono">{strings.demoBanner}</span>
            <span className="switcher">
              <DemoUserSwitcher />
            </span>
          </div>
        )}
        <div className={`page${wide ? ' wide' : ''}`}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
