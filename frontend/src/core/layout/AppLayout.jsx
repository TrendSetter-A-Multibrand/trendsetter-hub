import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Dropdown } from 'antd'
import { EllipsisOutlined } from '@ant-design/icons'
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
  const { me, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  // Все модули остаются в меню; недоступные открываются заглушкой «Нет доступа» (ModulePage)
  const navModules = MODULES.map((m, i) => ({
    ...m,
    idx: String(i + 1).padStart(2, '0'),
    allowed: (me.module_access[m.id] ?? 'none') !== 'none',
  }))

  const wide = Boolean(navModules.find((m) => m.allowed && m.wide && location.pathname === `/modules/${m.id}`))

  const dropdownItems = [
    {
      key: 'info',
      disabled: true,
      label: (
        <div style={{ cursor: 'default' }}>
          <div>{me.full_name}</div>
          <div>{strings.levels[me.access_level]}</div>
          <div>
            {s.departments}: {me.departments.map((d) => d.name).join(', ') || strings.dash}
          </div>
        </div>
      ),
    },
    { type: 'divider' },
    { key: 'profile', label: s.profileLink },
    ...(me.can_manage_users ? [{ key: 'admin', label: s.adminLink }] : []),
    { key: 'logout', label: s.logout },
  ]

  const onUserMenu = async ({ key }) => {
    if (key === 'profile') navigate('/profile')
    if (key === 'admin') navigate('/admin')
    if (key === 'logout') await logout()
  }

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
            <span className="nav-title">{s.home}</span>
          </Link>
          <div className="nav-label mono">{s.departmentsLabel}</div>
          <div className="nav-list">
            {navModules.map((m) => {
              const path = `/modules/${m.id}`
              const active = location.pathname === path
              const badge = me.module_badges?.[m.id] ?? 0
              return (
                <Link key={m.id} to={path} className={`nav-item${m.Component && m.allowed ? ' live' : ''}${active ? ' active' : ''}`}>
                  <span className="nav-dot" />
                  <span className="nav-text">
                    <span className="nav-title">{m.strings.tool}</span>
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
            <Dropdown menu={{ items: dropdownItems, onClick: onUserMenu }} trigger={['click']} placement="topLeft">
              <button type="button" className="icon-btn" aria-label={s.userMenu}>
                <EllipsisOutlined />
              </button>
            </Dropdown>
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
