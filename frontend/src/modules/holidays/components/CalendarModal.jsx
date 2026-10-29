import { useState } from 'react'
import { Alert, Modal, Spin } from 'antd'
import { COUNTRIES, formatRange, groupRanges, indexDays, todayIn } from '../lib/holidays.js'
import { useYearDays } from '../lib/useYearDays.js'
import strings from '../strings.js'
import YearCalendar, { YearToolbar } from './YearCalendar.jsx'
import '../holidays.css'

const s = strings.calendar

// Модальное окно виджета: производственный календарь за год (только чтение). Смена страны запроса не делает, смена года — делает.
export default function CalendarModal({ onClose }) {
  const [country, setCountry] = useState(COUNTRIES[0].id)
  const [year, setYear] = useState(() => new Date().getFullYear())
  const { rows, error } = useYearDays(year)
  const index = rows ? indexDays(rows) : null
  const today = todayIn(COUNTRIES.find((c) => c.id === country).timezone)
  const ranges = rows ? groupRanges(rows.filter((r) => r.country === country)) : []

  return (
    <Modal open centered width={960} footer={null} title={strings.title} onCancel={onClose}>
      <YearToolbar country={country} onCountry={setCountry} year={year} onYear={setYear} />
      {error ? (
        <Alert type="error" showIcon title={s.loadError} />
      ) : !index ? (
        <Spin />
      ) : (
        <>
          <YearCalendar year={year} rows={index[country]} today={today} />
          <h3 className="hc-list-title">{s.listTitle}</h3>
          {ranges.length === 0 && <div className="hc-empty-note">{s.empty}</div>}
          <ul className="hc-list">
            {ranges.map((r) => (
              <li className="hc-list-row" key={`${r.start}|${r.kind}`}>
                <span className="hc-list-when mono">{formatRange(r.start, r.end)}</span>
                <span>{[strings.kinds[r.kind], r.name].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  )
}
