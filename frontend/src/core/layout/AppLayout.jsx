import { useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { CloseOutlined, DownOutlined, MenuOutlined } from '@ant-design/icons'
import { useAuth } from '../auth/useAuth.js'
import { DEMO_MODE } from '../config.js'
import { MODULES } from '../../modules/registry.js'
import strings from '../strings.js'
import DemoUserSwitcher from './DemoUserSwitcher.jsx'
import Logo from './Logo.jsx'
import NotificationsBell from './NotificationsBell.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import mascot from './mascot.svg'

const s = strings.layout

export default function AppLayout() {
  const { me } = useAuth()
  const location = useLocation()
  // Мобильное меню (< 768): открывается кнопкой в шапке, закрывается при переходе по ссылке
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPath, setMenuPath] = useState(location.pathname + location.search)
  if (menuPath !== location.pathname + location.search) {
    setMenuPath(location.pathname + location.search)
    if (menuOpen) setMenuOpen(false)
  }

  // Все модули, кроме скрытых (hidden), остаются в меню; недоступные открываются заглушкой «Нет доступа» (ModulePage)
  const navModules = MODULES.filter((m) => !m.hidden).map((m) => ({
    ...m,
    allowed: (me.module_access[m.id] ?? 'none') !== 'none',
  }))

  const wide = Boolean(navModules.find((m) => m.allowed && m.wide && location.pathname === `/modules/${m.id}`))

  return (
    <div className={`shell${menuOpen ? ' menu-open' : ''}`}>
      <header className="topbar">
        <Logo />
        <div className="topbar-actions">
          <ThemeToggle />
          <button
            type="button"
            className="icon-btn"
            aria-label={menuOpen ? s.closeMenu : s.openMenu}
            aria-expanded={menuOpen}
            aria-controls="sidebar"
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <CloseOutlined /> : <MenuOutlined />}
          </button>
        </div>
      </header>
      {menuOpen && <button type="button" className="sidebar-backdrop" aria-label={s.closeMenu} onClick={() => setMenuOpen(false)} />}

      <aside className="sidebar" id="sidebar">
        <div className="brand">
          <Logo />
          <div className="brand-sub">{strings.brandSub}</div>
        </div>
        <nav aria-label={strings.mainNav}>
          <Link to="/" className={`nav-item${location.pathname === '/' ? ' active' : ''}`} aria-current={location.pathname === '/' ? 'page' : undefined}>
            <span className="nav-text">
              <span className="nav-title">
                <span className="nav-title-text">{s.home}</span>
              </span>
            </span>
          </Link>
          <div className="nav-label">{s.departmentsLabel}</div>
          <div className="nav-list">
            {navModules.map((m) => {
              const path = `/modules/${m.id}`
              const active = location.pathname === path
              const badge = me.module_badges?.[m.id] ?? 0
              const grouped = Boolean(m.sections && m.allowed && m.Component)
              const link = (
                <Link
                  key={m.id}
                  to={path}
                  className={`nav-item${m.Component && m.allowed ? '' : ' dim'}${active ? ' active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="nav-text">
                    <span className="nav-title">
                      <span className="nav-title-text">{m.strings.tool}</span>
                    </span>
                    <span className="nav-dept">{m.strings.dept}</span>
                  </span>
                  {badge > 0 && (
                    <span className="nav-badge" aria-label={s.moduleBadge(badge)}>
                      {badge}
                    </span>
                  )}
                  {grouped && <DownOutlined className="nav-chevron" aria-hidden />}
                </Link>
              )
              // разделы модуля (sections в реестре) — раскрыты на странице модуля, при наведении и на телефоне
              if (!grouped) return link
              const current = new URLSearchParams(location.search).get('section') ?? m.sections[0].key
              return (
                <div key={m.id} className={`nav-group${active ? ' open' : ''}`}>
                  {link}
                  <div className="nav-sections">
                    {m.sections.map((sec) => {
                      const on = active && current === sec.key
                      return (
                        <Link
                          key={sec.key}
                          to={`${path}?section=${sec.key}`}
                          className={`nav-section${on ? ' active' : ''}`}
                          aria-current={on ? 'page' : undefined}
                        >
                          {sec.label}
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </nav>
        <div className="user-slot">
          <div className="user-box">
            <Link to="/profile" className="user-link" aria-label={s.openProfile}>
              {/* Фирменный маскот TRENDSETTER вместо инициалов: своих фото у учётной записи хаба нет */}
              <span className="user-avatar">
                <img src={mascot} alt="" width="36" height="36" />
              </span>
              <span className="user-text">
                <span className="user-name" title={me.full_name}>
                  {me.full_name}
                </span>
                <span className="user-role">{strings.levels[me.access_level]}</span>
              </span>
            </Link>
            <div className="user-actions">
              <ThemeToggle />
              <NotificationsBell />
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        {DEMO_MODE && (
          <div className="demo-banner">
            <span className="dot" />
            <span>{strings.demoBanner}</span>
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
