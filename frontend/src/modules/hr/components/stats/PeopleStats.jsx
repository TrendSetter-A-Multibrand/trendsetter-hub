import { useState } from 'react'
import { Alert, Collapse, Skeleton, Tag } from 'antd'
import { formatDate } from '../../../../core/dates.js'
import strings from '../../strings.js'
import { formatTenure, toDonutItems } from '../../lib/stats.js'
import { BarList, Donut, Kpi } from './charts.jsx'

const s = strings.stats
const OPEN_KEY = 'hr.people.stats'
const GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }
const GRID_WIDE = { ...GRID, gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }
const PANEL = { border: '1px solid #E6E1DE', background: '#fff', borderRadius: 4, padding: '12px 14px' }

const loadOpen = () => {
  try {
    return localStorage.getItem(OPEN_KEY) !== 'closed'
  } catch {
    return true
  }
}
const saveOpen = (open) => {
  try {
    localStorage.setItem(OPEN_KEY, open ? 'open' : 'closed')
  } catch {
    // состояние просто не запомнится
  }
}

function DirTag({ d }) {
  return d ? (
    <Tag variant="solid" style={{ background: d.color, color: d.avatarInk, marginInlineEnd: 0 }}>
      {d.shortName}
    </Tag>
  ) : null
}

function Panel({ title, source, children }) {
  return (
    <div style={PANEL}>
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{title}</div>
      {source && <div style={{ fontSize: 12, color: '#8A837F', marginBottom: 8 }}>{source}</div>}
      {children}
    </div>
  )
}

// dist: { known, items }; labelOf(item) -> подпись. Значения без указания в кольцо не входят (доли — от known)
function DonutPanel({ title, source, dist, total, labelOf }) {
  const items = toDonutItems(dist.items, labelOf)
  const caption = s.known(dist.known, total)
  return (
    <Panel title={title} source={source}>
      {dist.known === 0 ? (
        <>
          <div style={{ color: '#8A837F', padding: '24px 0' }}>{s.noData}</div>
          <div style={{ fontSize: 12, color: '#8A837F' }}>{caption}</div>
        </>
      ) : (
        <Donut items={items} center={caption} />
      )}
    </Panel>
  )
}

function PersonLine({ p, directionOf, extra }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '3px 0' }}>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
      <DirTag d={directionOf(p.directionId)} />
      <span style={{ color: '#5B5552', fontVariantNumeric: 'tabular-nums' }}>{extra}</span>
    </div>
  )
}

function LeaveList({ title, list, directionOf }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 12, color: '#8A837F' }}>{title}</div>
      {list.length === 0 && <div style={{ fontSize: 13, color: '#8A837F' }}>{s.lists.empty}</div>}
      {list.map((l) => (
        <PersonLine
          key={l.personId}
          p={l}
          directionOf={directionOf}
          extra={`${strings.leave.kinds[l.kind] ?? l.kind}, ${formatDate(l.start)} – ${formatDate(l.end)}`}
        />
      ))}
    </div>
  )
}

function Body({ stats, directions }) {
  const c = s.cards
  const directionOf = (id) => directions?.find((d) => d.id === id) ?? null
  const leaveNow = stats.leave.now
  const { average } = stats.age
  const { averageMonths } = stats.tenure
  const leaveHint = leaveNow.length > 0 && (
    <div>
      {leaveNow.map((l) => (
        <div key={l.personId}>{`${l.name}: ${formatDate(l.start)} – ${formatDate(l.end)}`}</div>
      ))}
    </div>
  )
  const total = stats.total
  const labelOf = (i) => i.label
  const keyed = (dict) => (i) => dict[i.key] ?? i.key

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, color: '#5B5552' }}>{s.asOf(formatDate(stats.asOf))}</div>
      <div style={GRID}>
        <Kpi title={c.total} value={total} sub={c.totalSub(stats.withAccount)} hint={c.totalHint} />
        <Kpi title={c.outsideMap} value={stats.hiddenFromMap} sub={c.outsideMapSub} hint={c.outsideMapHint} />
        <Kpi title={c.directions} value={stats.directions.length} sub={c.directionsSub(stats.teamsCount)} hint={c.directionsHint} />
        <Kpi title={c.managers} value={stats.managers.count} sub={c.managersSub(stats.managers.avgSpan)} hint={c.managersHint} />
        <Kpi
          title={c.newcomers(stats.newcomers.days)}
          value={stats.newcomers.count}
          sub={c.newcomersSub(stats.dismissed.count, stats.dismissed.days, stats.upcomingHires)}
          hint={c.newcomersHint(stats.newcomers.days)}
        />
        <Kpi title={c.probation} value={stats.probation.count} hint={c.probationHint} />
        <Kpi
          title={c.leaveNow}
          value={leaveNow.length}
          sub={c.leaveNowSub(stats.leave.soon.length, stats.leave.soonDays)}
          hint={leaveHint || c.leaveNowHint}
        />
        <Kpi
          title={c.avgAge}
          value={average === null ? strings.none : `${String(average).replace('.', ',')} ${s.yearsUnit}`}
          hint={average === null ? `${c.avgAgeHint} ${s.fewData}.` : c.avgAgeHint}
        />
        <Kpi
          title={c.avgTenure}
          value={averageMonths === null ? strings.none : formatTenure(averageMonths)}
          hint={averageMonths === null ? `${c.avgTenureHint} ${s.fewData}.` : c.avgTenureHint}
        />
      </div>

      <div style={GRID_WIDE}>
        <DonutPanel title={s.charts.location} source={s.charts.locationSource} dist={stats.location} total={total} labelOf={labelOf} />
        <DonutPanel title={s.charts.workFormat} source={s.charts.workFormatSource} dist={stats.workFormat} total={total} labelOf={labelOf} />
        <DonutPanel title={s.charts.gender} source={s.charts.genderSource} dist={stats.gender} total={total} labelOf={keyed(s.gender)} />
        <DonutPanel title={s.charts.country} source={s.charts.countrySource} dist={stats.country} total={total} labelOf={keyed(strings.policies.countries)} />
        <DonutPanel
          title={s.charts.employmentType}
          source={s.charts.employmentTypeSource}
          dist={stats.employmentType}
          total={total}
          labelOf={keyed(strings.dossier.employmentTypes)}
        />
        <DonutPanel title={s.charts.age} dist={{ known: stats.age.known, items: stats.age.buckets }} total={total} labelOf={keyed(s.age)} />
        <DonutPanel title={s.charts.tenure} dist={{ known: stats.tenure.known, items: stats.tenure.buckets }} total={total} labelOf={keyed(s.tenure)} />
      </div>

      <div style={GRID_WIDE}>
        <Panel title={s.lists.byDirection}>
          <BarList
            rows={stats.directions.map((d) => ({
              label: directionOf(d.id)?.shortName ?? d.id,
              value: d.count,
              color: directionOf(d.id)?.color ?? '#B3ACA9',
              total,
            }))}
          />
        </Panel>
        <Panel title={s.lists.managers}>
          {stats.managers.top.map((m) => (
            <PersonLine key={m.personId} p={m} directionOf={directionOf} extra={`${m.reports} ${s.lists.managersReports}`} />
          ))}
        </Panel>
        <Panel title={s.lists.leave}>
          <LeaveList title={s.lists.leaveNow} list={stats.leave.now} directionOf={directionOf} />
          <LeaveList title={s.lists.leaveSoon} list={stats.leave.soon} directionOf={directionOf} />
        </Panel>
      </div>
    </div>
  )
}

export default function PeopleStats({ stats, error, directions }) {
  const [open, setOpen] = useState(loadOpen)
  let content = <Skeleton active />
  if (stats) content = <Body stats={stats} directions={directions} />
  else if (error) content = <Alert type="error" showIcon title={s.loadFailed} description={error} />
  return (
    <Collapse
      style={{ marginBottom: 16 }}
      activeKey={open ? ['stats'] : []}
      onChange={(keys) => {
        const next = keys.length > 0
        setOpen(next)
        saveOpen(next)
      }}
      items={[{ key: 'stats', label: s.title, children: content }]}
    />
  )
}
