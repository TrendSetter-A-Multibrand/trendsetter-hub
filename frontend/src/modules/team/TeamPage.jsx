import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, Spin } from 'antd'
import strings from './strings.js'
import TeamHeader from './components/TeamHeader.jsx'
import DirectionsView from './components/DirectionsView.jsx'
import SchemeView from './components/SchemeView.jsx'
import LeaveView from './components/LeaveView.jsx'
import ProfileDrawer from './components/ProfileDrawer.jsx'
import MyProfileDrawer from './components/MyProfileDrawer.jsx'
import { buildIndex, collapseLeaders, findMatches, forceOpenSet, parseId, pathSet } from './lib/tree.js'
import { useMyProfile, useTeamMap } from './lib/useTeamMap.js'
import { useLeaveRange } from './lib/useLeave.js'
import { awayMap, monthEnd, monthStart } from './lib/leave.js'
import { todayIso } from '../../core/dates.js'
import './team.css'

function TeamMap({ map, access }) {
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState({})
  const [formOpen, setFormOpen] = useState(false)
  const limited = access === 'structure'
  const { me, reload: reloadMe } = useMyProfile(!limited)
  const idx = useMemo(() => buildIndex(map.people, map.directions), [map])

  // Метка «в отпуске»: один запрос календаря на текущий месяц при открытии карты; при ошибке/403 метки просто нет
  const today = todayIso()
  const { data: monthLeaves } = useLeaveRange(monthStart(today), monthEnd(monthStart(today)), !limited)
  const away = useMemo(() => awayMap(monthLeaves, today), [monthLeaves, today])

  // состояние в URL: ?view=scheme&dir=<id направления>&p=<id человека>
  const viewParam = params.get('view')
  const view = viewParam === 'scheme' ? 'scheme' : viewParam === 'leave' && !limited ? 'leave' : 'cards'
  // последний режим структуры («Направления»/«Схема») — к нему возвращает повторный клик «Отпуска»
  const [lastStruct, setLastStruct] = useState(view === 'scheme' ? 'scheme' : 'cards')
  const dirParam = params.get('dir')
  const dirFilter = idx.dirs.some((d) => d.id === dirParam) ? dirParam : null
  const selectedId = parseId(params.get('p'), idx.by)

  const update = useCallback(
    (patch) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          Object.entries(patch).forEach(([k, v]) => (v === null || v === undefined ? next.delete(k) : next.set(k, String(v))))
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && update({ p: null })
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [update])

  const path = useMemo(() => pathSet(idx.by, selectedId), [idx, selectedId])
  const matches = useMemo(() => findMatches(idx.by, query), [idx, query])
  const forceOpen = useMemo(() => forceOpenSet(idx.by, matches), [idx, matches])
  const toggle = (id) => setCollapsed((c) => ({ ...c, [id]: !c[id] }))
  const selected = selectedId === null ? null : idx.by[selectedId]

  if (idx.totalPeople === 0) return <Alert type="info" showIcon title={strings.state.empty} style={{ margin: 28 }} />

  // в схеме drawer рендерится внутри контейнера схемы, чтобы был виден в полноэкранном режиме
  const drawer = selected && (
    <ProfileDrawer
      person={selected}
      by={idx.by}
      limited={limited}
      away={away[selected.id]}
      onSelect={(id) => update({ p: id })}
      onClose={() => update({ p: null })}
      onEditOwn={me && me.person?.id === selected.id ? () => setFormOpen(true) : undefined}
    />
  )

  return (
    <div className={`tm-main${selected ? ' has-drawer' : ''}`}>
      <TeamHeader
        query={query}
        onQuery={setQuery}
        found={matches ? matches.size : null}
        onLeaders={() => setCollapsed(collapseLeaders(idx.by, idx.ceoId))}
        onExpand={() => setCollapsed({})}
        view={view}
        lastStruct={lastStruct}
        onView={(v) => {
          if (v === 'leave' && view !== 'leave') setLastStruct(view)
          if (v !== 'leave') setLastStruct(v)
          update({ view: v === 'cards' ? null : v })
        }}
        canLeave={!limited}
        dirs={idx.dirs}
        total={idx.totalPeople}
        dirFilter={dirFilter}
        onDir={(id) => update({ dir: id })}
        onMyProfile={me ? () => setFormOpen(true) : undefined}
      />
      {view === 'cards' ? (
        <DirectionsView
          idx={idx}
          selectedId={selectedId}
          matches={matches}
          path={path}
          collapsed={collapsed}
          forceOpen={forceOpen}
          dirFilter={dirFilter}
          away={away}
          onSelect={(id) => update({ p: id })}
          onToggle={toggle}
        />
      ) : view === 'leave' ? (
        <LeaveView
          idx={idx}
          selectedId={selectedId}
          matches={matches}
          path={path}
          collapsed={collapsed}
          forceOpen={forceOpen}
          dirFilter={dirFilter}
          onSelect={(id) => update({ p: id })}
          onToggle={toggle}
        />
      ) : (
        <SchemeView
          idx={idx}
          selectedId={selectedId}
          matches={matches}
          path={path}
          collapsed={collapsed}
          forceOpen={forceOpen}
          dirFilter={dirFilter}
          away={away}
          onSelect={(id) => update({ p: id })}
          onToggle={toggle}
        >
          {drawer}
        </SchemeView>
      )}
      {view !== 'scheme' && drawer}
      {formOpen && me && <MyProfileDrawer me={me} onClose={() => setFormOpen(false)} onChanged={reloadMe} />}
    </div>
  )
}

export default function TeamPage({ access }) {
  const { status, map, error } = useTeamMap()
  return (
    <div className="tm">
      {status === 'loading' && (
        <div className="tm-state">
          <Spin />
          <span className="mono">{strings.state.loading}</span>
        </div>
      )}
      {status === 'error' && <Alert type="error" showIcon title={strings.state.loadError} description={error} style={{ margin: 28 }} />}
      {status === 'ready' && <TeamMap map={map} access={access} />}
    </div>
  )
}
