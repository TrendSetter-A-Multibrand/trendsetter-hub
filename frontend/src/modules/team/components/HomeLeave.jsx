import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Spin } from 'antd'
import { addDays, formatDate, todayIso } from '../../../core/dates.js'
import { homeLeave } from '../lib/leave.js'
import { useLeaveRange } from '../lib/useLeave.js'
import strings from '../strings.js'

const s = strings.home
const MAX_ROWS = 5
const LEAVE_DAYS = 14
const shortDate = (iso) => formatDate(iso).slice(0, 5) // DD.MM

function PeopleList({ title, rows, empty, when }) {
  const hidden = rows.length - MAX_ROWS
  return (
    <>
      <div className="home-card-head mono">{title}</div>
      {rows.length === 0 && <div className="people-empty">{empty}</div>}
      {rows.slice(0, MAX_ROWS).map((r) => (
        <div className="people-row" key={`${r.personId}|${r.start ?? ''}`}>
          <span className="people-name">{r.name}</span>
          <span className="people-when mono">{when(r)}</span>
        </div>
      ))}
      {hidden > 0 && (
        <Link to="/modules/team?view=leave" className="link-mono mono">
          {s.more(hidden)}
        </Link>
      )}
    </>
  )
}

// Блок главной (HOME_WIDGETS): кто в отпуске сегодня и ближайшие отпуска. Вид отпуска (kind) не выводится.
export default function HomeLeave() {
  const [today] = useState(todayIso)
  const { data, error } = useLeaveRange(today, addDays(today, LEAVE_DAYS), true)
  const { away, upcoming } = homeLeave(data, today, LEAVE_DAYS)

  return (
    <section className="home-card">
      {error ? (
        <Alert type="error" showIcon title={strings.leave.loadError} />
      ) : data === null ? (
        <Spin size="small" />
      ) : (
        <>
          <PeopleList title={s.awayTitle} rows={away} empty={s.awayEmpty} when={(r) => s.until(shortDate(r.end))} />
          <div className="people-gap" />
          <PeopleList title={s.upcomingTitle} rows={upcoming} empty={s.upcomingEmpty} when={(r) => s.from(shortDate(r.start))} />
        </>
      )}
    </section>
  )
}
