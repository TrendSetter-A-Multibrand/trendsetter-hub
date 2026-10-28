import { useMemo, useState } from 'react'
import { Alert, Input, Select, Space, Spin, Tag, Typography } from 'antd'
import { formatDate, todayIso } from '../../../core/dates.js'
import strings from '../strings.js'
import { useLoad } from '../lib/useLoad.js'
import { directionOptions } from '../lib/options.js'
import { barPosition, monthColumns, monthLoad, OVERLOAD_THRESHOLD, planRows } from '../lib/plan.js'

const s = strings.plan
const t = s.tab
const STATUS_COLORS = { planned: '#4A7FB5', converted: '#6FA287' }
const NAME_WIDTH = 220
const TRACK_MIN = 720
const LINE = '1px solid var(--border-soft)'
const OVERLOAD_BG = 'var(--tint-red)'

function DirTag({ d }) {
  return (
    <Tag variant="solid" style={{ background: d.color, color: d.avatarInk, marginInlineEnd: 0 }}>
      {d.shortName}
    </Tag>
  )
}

// Нагрузка по месяцам: доля людей направления с плановым периодом в месяце; от порога — подсветка (запретов нет)
function LoadTable({ rows }) {
  return (
    <section>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        {t.loadTitle}
      </Typography.Title>
      <Typography.Paragraph type="secondary">{t.loadNote(Math.round(OVERLOAD_THRESHOLD * 100))}</Typography.Paragraph>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720, fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '6px 8px', width: 160 }}>{t.direction}</th>
              {t.months.map((m) => (
                <th key={m} className="mono" style={{ padding: '6px 4px', fontSize: 11, fontWeight: 500, color: 'var(--faint)' }}>
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ direction, size, months }) => (
              <tr key={direction.id} style={{ borderTop: LINE }}>
                <td style={{ padding: '6px 8px' }}>
                  <DirTag d={direction} /> <span style={{ color: 'var(--faint)' }}>{size}</span>
                </td>
                {months.map((m, i) => (
                  <td
                    key={i}
                    title={m.count > 0 ? t.loadCell(m.count, size) : undefined}
                    style={{ textAlign: 'center', padding: '6px 4px', background: m.over ? OVERLOAD_BG : undefined, fontWeight: m.over ? 500 : 400, color: m.count ? undefined : 'var(--border-dashed)' }}
                  >
                    {m.count ? `${Math.round(m.ratio * 100)}%` : t.noLoad}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// Годовой таймлайн: строки — люди по направлениям, горизонталь — год; отрезки — плановые периоды, цвет = статус
function Timeline({ groups, year }) {
  const cols = useMemo(() => monthColumns(year), [year])
  const today = todayIso()
  const todayPos = today.startsWith(String(year)) ? barPosition(today, today, year) : null
  const track = { position: 'relative', flex: 1, minWidth: TRACK_MIN, minHeight: 30 }
  const monthLines = cols.map((c) => <div key={c.month} style={{ position: 'absolute', top: 0, bottom: 0, left: `${c.left}%`, borderLeft: LINE }} />)

  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', background: 'var(--surface)' }}>
      <div style={{ minWidth: NAME_WIDTH + TRACK_MIN }}>
        <div style={{ display: 'flex' }}>
          <div style={{ width: NAME_WIDTH, flex: 'none', position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 3 }} />
          <div style={{ ...track, minHeight: 32 }}>
            {cols.map((c) => (
              <div key={c.month} className="mono" style={{ position: 'absolute', left: `${c.left}%`, width: `${c.width}%`, top: 8, textAlign: 'center', fontSize: 11, color: 'var(--faint)' }}>
                {t.months[c.month - 1]}
              </div>
            ))}
          </div>
        </div>
        {groups.map(({ direction, rows }) => (
          <div key={direction.id}>
            <div style={{ padding: '6px 10px', background: 'var(--surface-2)', borderTop: LINE, position: 'sticky', left: 0 }}>
              <DirTag d={direction} /> <span style={{ color: 'var(--faint)', fontSize: 12 }}>{rows.length}</span>
            </div>
            {rows.map(({ person, plans }) => (
              <div key={person.id} style={{ display: 'flex', borderTop: LINE }}>
                <div
                  style={{
                    width: NAME_WIDTH, flex: 'none', position: 'sticky', left: 0, zIndex: 3, background: 'var(--surface)', padding: '6px 10px',
                    fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', borderRight: LINE,
                  }}
                  title={person.name}
                >
                  {person.name}
                </div>
                <div style={track}>
                  {monthLines}
                  {todayPos && <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${todayPos.left}%`, borderLeft: '1.5px solid var(--red)' }} />}
                  {plans.map((pl) => {
                    const pos = barPosition(pl.start, pl.end, year)
                    return (
                      pos && (
                        <div
                          key={pl.id}
                          title={t.tip(person.name, formatDate(pl.start), formatDate(pl.end), pl.comment)}
                          style={{
                            position: 'absolute', top: 6, height: 18, borderRadius: 4, minWidth: 3, left: `${pos.left}%`, width: `${pos.width}%`,
                            background: STATUS_COLORS[pl.status] ?? STATUS_COLORS.planned, zIndex: 2,
                          }}
                        />
                      )
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// Вкладка HR «График»: годовой план отпусков всех сотрудников + нагрузка по направлениям
export default function PlanTab() {
  const thisYear = Number(todayIso().slice(0, 4))
  const [year, setYear] = useState(thisYear)
  const [query, setQuery] = useState('')
  const [directionId, setDirectionId] = useState(null)
  const { data: plans, error } = useLoad(`/modules/hr/leave/plan?year=${year}`)
  const { data: people, error: peopleError } = useLoad('/modules/team/hr/people')
  const { data: directions, error: directionsError } = useLoad('/modules/team/hr/directions')

  const ready = plans && people && directions
  const visibleDirections = useMemo(() => (directions ?? []).filter((d) => !directionId || d.id === directionId), [directions, directionId])
  const load = useMemo(() => (ready ? monthLoad(plans, people, visibleDirections, year) : []), [ready, plans, people, visibleDirections, year])
  const groups = useMemo(() => (ready ? planRows(plans, people, directions, { query, directionId }) : []), [ready, plans, people, directions, query, directionId])

  const failed = error ?? peopleError ?? directionsError
  if (failed && !ready) return <Alert type="error" showIcon title={s.loadFailed} description={failed} />
  return (
    <Space orientation="vertical" size={20} style={{ width: '100%' }}>
      <Space wrap>
        <Select
          style={{ width: 110 }}
          aria-label={s.year}
          value={year}
          onChange={setYear}
          options={[thisYear - 1, thisYear, thisYear + 1].map((y) => ({ value: y, label: String(y) }))}
        />
        <Input.Search allowClear style={{ width: 260 }} placeholder={t.search} aria-label={t.search} value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select
          allowClear
          style={{ width: 220 }}
          placeholder={t.allDirections}
          aria-label={t.directionFilter}
          value={directionId}
          onChange={(v) => setDirectionId(v ?? null)}
          options={directionOptions(directions ?? [])}
        />
        <Space size={12} style={{ color: 'var(--faint)', fontSize: 12 }} aria-label={t.legend}>
          {Object.entries(STATUS_COLORS).map(([status, color]) => (
            <span key={status}>
              <i style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: color, marginRight: 6, verticalAlign: -1 }} />
              {s.statuses[status].label}
            </span>
          ))}
        </Space>
      </Space>
      <Alert
        type="info"
        showIcon
        title={t.howTitle}
        description={
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {t.howText.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        }
      />
      {!ready ? (
        <Spin />
      ) : (
        <>
          <LoadTable rows={load} />
          {plans.length === 0 && <Alert type="info" showIcon title={t.noPlans} />}
          {groups.length === 0 ? <Alert type="info" showIcon title={t.empty} /> : <Timeline groups={groups} year={year} />}
        </>
      )}
    </Space>
  )
}
