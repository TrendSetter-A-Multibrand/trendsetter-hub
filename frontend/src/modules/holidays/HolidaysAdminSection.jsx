import { useState } from 'react'
import { Alert, App, Button, Popconfirm, Spin } from 'antd'
import { api } from '../../core/api/index.js'
import { addDays, countDays } from '../../core/dates.js'
import { COUNTRIES, formatRange, groupRanges, indexDays, isWeekend, todayIn } from './lib/holidays.js'
import { useYearDays } from './lib/useYearDays.js'
import strings from './strings.js'
import DaysModal from './components/DaysModal.jsx'
import YearCalendar, { YearToolbar } from './components/YearCalendar.jsx'
import './holidays.css'

const s = strings.admin
const CHUNK_DAYS = 31 // сервер принимает не больше 31 дня за раз; длинный склеенный диапазон удаляется частями

// Раздел «Производственный календарь» (/modules/holidays, только редактор): календарь года, клик по дню, диапазоны, список с правкой и удалением.
export default function HolidaysAdminSection() {
  const { message } = App.useApp()
  const [country, setCountry] = useState(COUNTRIES[0].id)
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [editing, setEditing] = useState(null) // null — закрыто, иначе начальные значения DaysModal
  const { rows, error, reload } = useYearDays(year)
  const index = rows ? indexDays(rows) : null
  const today = todayIn(COUNTRIES.find((c) => c.id === country).timezone)
  const ranges = rows ? groupRanges(rows.filter((r) => r.country === country)) : []

  const openDay = (iso) => {
    const row = index[country].get(iso)
    setEditing({ country, start: iso, end: iso, kind: row?.kind ?? (isWeekend(iso) ? 'workday' : 'holiday'), name: row?.name ?? '' })
  }

  const remove = async (range) => {
    try {
      for (let offset = 0; offset < countDays(range.start, range.end); offset += CHUNK_DAYS) {
        const start = addDays(range.start, offset)
        const end = addDays(start, CHUNK_DAYS - 1) < range.end ? addDays(start, CHUNK_DAYS - 1) : range.end
        await api.post('/modules/holidays/days/delete', { country: range.country, start, end })
      }
      message.success(s.removed)
    } catch (e) {
      message.error(e.message)
    }
    reload()
  }

  return (
    <div className="hc-admin">
      <h1 className="h1">{s.pageTitle}</h1>
      <YearToolbar country={country} onCountry={setCountry} year={year} onYear={setYear}>
        <Button type="primary" onClick={() => setEditing({ country, start: '', end: '', kind: 'holiday', name: '' })}>
          {s.markDays}
        </Button>
      </YearToolbar>
      {error ? (
        <Alert type="error" showIcon title={strings.calendar.loadError} />
      ) : !index ? (
        <Spin />
      ) : (
        <>
          <YearCalendar year={year} rows={index[country]} today={today} onDayClick={openDay} />
          <h3 className="hc-list-title">{strings.calendar.listTitle}</h3>
          {ranges.length === 0 && <div className="hc-empty-note">{strings.calendar.empty}</div>}
          <ul className="hc-list">
            {ranges.map((r) => (
              <li className="hc-list-row" key={`${r.start}|${r.kind}`}>
                <span className="hc-list-when mono">{formatRange(r.start, r.end)}</span>
                <span className="hc-list-text">{[strings.kinds[r.kind], r.name].filter(Boolean).join(' · ')}</span>
                <span className="hc-list-actions">
                  <Button size="small" type="link" onClick={() => setEditing({ ...r, name: r.name ?? '' })}>
                    {s.edit}
                  </Button>
                  <Popconfirm title={s.removeConfirm} okText={s.confirmYes} cancelText={s.confirmNo} onConfirm={() => remove(r)}>
                    <Button size="small" type="link" danger>
                      {s.remove}
                    </Button>
                  </Popconfirm>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {editing && index && <DaysModal initial={editing} rowsByCountry={index} onClose={() => setEditing(null)} onDone={reload} />}
    </div>
  )
}
