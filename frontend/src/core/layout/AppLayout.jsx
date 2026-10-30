import { Suspense, useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { CloseOutlined, DownOutlined, MenuOutlined, SearchOutlined } from '@ant-design/icons'
import { useAuth } from '../auth/useAuth.js'
import { DEMO_MODE } from '../config.js'
import { isModuleHidden } from '../access.js'
import { MODULES, OFFICE_SECTIONS, TOPLINE_ACTIONS } from '../../modules/registry.js'
import strings from '../strings.js'
import DemoUserSwitcher from './DemoUserSwitcher.jsx'
import Logo from './Logo.jsx'
import { moduleNumber } from './moduleNumber.js'
import NotificationsBell from './NotificationsBell.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import VersionButton from './VersionButton.jsx'
import logoWhite from './logo-white.svg'

const s = strings.layout
const YEAR = new Date().getFullYear()

const initials = (name) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')

// Выбранный пункт — капсом в скобках: [  ПРИЁМКА  ]
function NavTitle({ text, active }) {
  if (!active) return <span className="nav-title">{text}</span>
  return (
    <span className="nav-title">
      <span className="bracket" aria-hidden="true">[</span>&nbsp;&nbsp;{text}&nbsp;&nbsp;<span className="bracket" aria-hidden="true">]</span>
    </span>
  )
}

// Хлебные крошки верхней строки: Хаб / Отдел / Раздел
function useCrumbs(navModules, officeTabs) {
  const location = useLocation()
  const { pathname, search } = location
  if (pathname === '/') return [s.hub, s.home]
  if (pathname === '/profile') return [s.hub, strings.profile.title]
  if (pathname === '/office') {
    const key = new URLSearchParams(search).get('tab')
    const tab = officeTabs.find((x) => x.id === key) ?? officeTabs[0]
    return tab ? [s.hub, strings.office.title, tab.label] : [s.hub, strings.office.title]
  }
  const m = navModules.find((x) => pathname === `/modules/${x.id}`)
  if (!m) return [s.hub]
  const crumbs = [s.hub, m.strings.dept, m.strings.tool]
  if (m.sections && m.allowed) {
    const key = new URLSearchParams(search).get('section') ?? m.sections[0].key
    const sec = m.sections.find((x) => x.key === key)
    if (sec) crumbs[2] = sec.label
  }
  return crumbs
}

export default function AppLayout() {
  const { me } = useAuth()
  const location = useLocation()
  const searchRef = useRef(null)
  const [query, setQuery] = useState('')
  // Мобильное меню (< 768): открывается кнопкой в шапке, закрывается при переходе по ссылке
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPath, setMenuPath] = useState(location.pathname + location.search)
  if (menuPath !== location.pathname + location.search) {
    setMenuPath(location.pathname + location.search)
    if (menuOpen) setMenuOpen(false)
  }

  // Все модули, кроме скрытых (hidden: boolean или (me) => boolean), остаются в меню; недоступные открываются заглушкой «Нет доступа» (ModulePage)
  const navModules = MODULES.filter((m) => !isModuleHidden(m, me)).map((m) => ({
    ...m,
    num: moduleNumber(m.id),
    allowed: (me.module_access[m.id] ?? 'none') !== 'none',
  }))
  // «Администрация» (/office): пункт виден, если видна хоть одна вкладка; число у пункта — сумма чисел видимых вкладок
  const officeTabs = OFFICE_SECTIONS.filter((x) => x.visible(me))
  const officeBadge = officeTabs.reduce((sum, x) => sum + (x.badge?.(me) ?? 0), 0)
  const crumbs = useCrumbs(navModules, officeTabs)

  const q = query.trim().toLowerCase()
  const matches = (...texts) => !q || texts.some((t) => t.toLowerCase().includes(q))
  const homeVisible = matches(s.home, s.homeSub)
  const shownModules = navModules.filter((m) => matches(m.strings.tool, m.strings.dept, ...(m.sections ?? []).map((x) => x.label)))

  const officeShown = officeTabs.length > 0 && matches(strings.office.title, strings.office.dept, ...officeTabs.map((x) => x.label))
  const officeActive = location.pathname === '/office'
  const wide = officeActive || Boolean(navModules.find((m) => m.allowed && m.wide && location.pathname === `/modules/${m.id}`))
  const homeActive = location.pathname === '/'

  // ⌘K / Ctrl+K — фокус в поиск по разделам
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const onSearchKey = (e) => {
    if (e.key === 'Escape') setQuery('')
  }

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
          <div className="brand-sub">[ {strings.brandSub} ]</div>
        </div>
        <label className="nav-search">
          <SearchOutlined aria-hidden />
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder={s.search}
            aria-label={s.searchLabel}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
          <kbd aria-hidden="true">⌘K</kbd>
        </label>
        <nav aria-label={strings.mainNav} className="nav-list">
          {homeVisible && (
            <Link to="/" className={`nav-item${homeActive ? ' active' : ''}`} aria-current={homeActive ? 'page' : undefined}>
              <span className="nav-num">—</span>
              <span className="nav-text">
                <NavTitle text={s.home} active={homeActive} />
                <span className="nav-dept">{s.homeSub}</span>
              </span>
            </Link>
          )}
          {shownModules.map((m) => {
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
                <span className="nav-num">{m.num}</span>
                <span className="nav-text">
                  <NavTitle text={m.strings.tool} active={active} />
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
            if (!grouped) return link
            // разделы модуля (sections в реестре) — раскрыты на странице модуля и при поиске
            const current = new URLSearchParams(location.search).get('section') ?? m.sections[0].key
            return (
              <div key={m.id} className={`nav-group${active || q ? ' open' : ''}`}>
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
                        {on ? (
                          <span>
                            <span className="bracket" aria-hidden="true">[</span>&nbsp;{sec.label}&nbsp;<span className="bracket" aria-hidden="true">]</span>
                          </span>
                        ) : (
                          sec.label
                        )}
                      </Link>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {officeShown && (
            <Link to="/office" className={`nav-item${officeActive ? ' active' : ''}`} aria-current={officeActive ? 'page' : undefined}>
              <span className="nav-num">—</span>
              <span className="nav-text">
                <NavTitle text={strings.office.title} active={officeActive} />
                <span className="nav-dept">{strings.office.dept}</span>
              </span>
              {officeBadge > 0 && (
                <span className="nav-badge" aria-label={s.moduleBadge(officeBadge)}>
                  {officeBadge}
                </span>
              )}
            </Link>
          )}
          {!homeVisible && shownModules.length === 0 && !officeShown && <div className="nav-empty">{s.searchEmpty}</div>}
        </nav>
        <div className="user-slot">
          <Link to="/profile" className="user-link" aria-label={s.openProfile}>
            <span className="user-avatar" aria-hidden="true">
              {initials(me.full_name)}
            </span>
            <span className="user-text">
              <span className="user-name" title={me.full_name}>
                {me.full_name}
              </span>
              <span className="user-role">{strings.levels[me.access_level]}</span>
            </span>
          </Link>
        </div>
      </aside>

      <main className="main">
        <div className="topline">
          <nav className="topline-crumbs" aria-label={s.crumbs}>
            {crumbs.map((c, i) => (
              <span key={c + i}>
                {i > 0 && <span aria-hidden="true">/ </span>}
                {i === 0 && crumbs.length > 1 ? <Link to="/">{c}</Link> : c}
              </span>
            ))}
          </nav>
          <div className="topline-actions">
            {DEMO_MODE && <span className="demo-flag">{s.demoData}</span>}
            <VersionButton />
            <NotificationsBell />
            <ThemeToggle />
            {TOPLINE_ACTIONS.filter((a) => a.visible(me)).map(({ id, Component }) => (
              <Suspense key={id} fallback={null}>
                <Component me={me} />
              </Suspense>
            ))}
            {DEMO_MODE && <DemoUserSwitcher />}
          </div>
        </div>
        <div className={`page${wide ? ' wide' : ''}`}>
          <Outlet />
        </div>
        <footer className="site-footer">
          <div className="site-footer-line">
            <span>{s.footer(YEAR)}</span>
          </div>
          <img className="site-footer-logo" src={logoWhite} alt="" aria-hidden="true" />
        </footer>
      </main>
    </div>
  )
}
