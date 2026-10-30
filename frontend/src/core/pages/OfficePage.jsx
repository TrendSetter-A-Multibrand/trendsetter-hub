import { Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Spin } from 'antd'
import { useAuth } from '../auth/useAuth.js'
import { OFFICE_SECTIONS } from '../../modules/registry.js'
import PageHead from '../layout/PageHead.jsx'
import strings from '../strings.js'
import NotFoundPage from './NotFoundPage.jsx'

const s = strings.office

// «Администрация» (/office): страница ядра с вкладками из OFFICE_SECTIONS реестра; вкладка выбирается ?tab=.
export default function OfficePage() {
  const { me } = useAuth()
  const [params, setParams] = useSearchParams()
  const tabs = OFFICE_SECTIONS.filter((x) => x.visible(me))
  if (tabs.length === 0) return <NotFoundPage />
  const active = tabs.find((x) => x.id === params.get('tab')) ?? tabs[0]
  const { Component } = active

  return (
    <div className="stack module">
      <PageHead eyebrow={s.dept} title={s.title}>
        <span className="seg" role="group" aria-label={s.tabsLabel}>
          {tabs.map((x) => {
            const badge = x.badge?.(me) ?? 0
            return (
              <button key={x.id} type="button" className="seg-btn" aria-pressed={active.id === x.id} onClick={() => setParams({ tab: x.id }, { replace: true })}>
                {x.label}
                {badge > 0 && <span className="nav-badge office-tab-badge">{badge}</span>}
              </button>
            )
          })}
        </span>
      </PageHead>
      <Suspense fallback={<Spin />}>
        <Component key={active.id} me={me} />
      </Suspense>
    </div>
  )
}
