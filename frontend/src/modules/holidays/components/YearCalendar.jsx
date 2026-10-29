import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { COUNTRIES, dayType, monthGrid } from '../lib/holidays.js'
import strings from '../strings.js'
import '../holidays.css'

const s = strings.calendar
const LEGEND = ['holiday', 'day_off', 'weekend', 'workday', 'short', 'work']
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

// Классы ячейки по типу дня (цвета и маркеры — в holidays.css)
const TYPE_CLASS = { holiday: 'hc-holiday', day_off: 'hc-dayoff', weekend: 'hc-weekend', workday: 'hc-workday', short: 'hc-short', work: 'hc-work' }

// Переключатель страны: .seg V1; value/onChange — чтобы работал и как поле antd Form
export function CountrySeg({ value, onChange }) {
  return (
    <span className="seg" role="group" aria-label={s.country}>
      {COUNTRIES.map((c) => (
        <button key={c.id} type="button" className="seg-btn" aria-pressed={value === c.id} onClick={() => onChange?.(c.id)}>
          {strings.countries[c.id]}
        </button>
      ))}
    </span>
  )
}

// Панель над сеткой: переключатель страны и года (общая для модалки и раздела редактора); children — справа (кнопки)
export function YearToolbar({ country, onCountry, year, onYear, children }) {
  return (
    <div className="hc-toolbar">
      <CountrySeg value={country} onChange={onCountry} />
      <div className="hc-year-switch">
        <Button size="small" icon={<LeftOutlined />} aria-label={s.prevYear} onClick={() => onYear(year - 1)} />
        <span className="hc-year-value mono">{year}</span>
        <Button size="small" icon={<RightOutlined />} aria-label={s.nextYear} onClick={() => onYear(year + 1)} />
      </div>
      {children}
    </div>
  )
}

// Сетка 12 месяцев одной страны за год. rows — Map<iso, строка> этой страны (indexDays); today — YYYY-MM-DD страны;
// onDayClick(iso) — необязательно: есть — ячейки-кнопки, нет — обычные блоки.
export default function YearCalendar({ year, rows, today, onDayClick }) {
  return (
    <div className="hc-year">
      <div className="hc-months">
        {MONTHS.map((month) => (
          <section className="hc-month" key={month}>
            <h3 className="hc-month-title">{strings.months[month - 1]}</h3>
            <div className="hc-grid">
              {strings.weekdays.map((w, i) => (
                <div className={`hc-wd${i >= 5 ? ' hc-wd-rest' : ''}`} key={w}>
                  {w}
                </div>
              ))}
              {monthGrid(year, month).flat().map((cell, i) => {
                if (!cell) return <div className="hc-cell hc-empty" key={`e${i}`} />
                const row = rows.get(cell.iso)
                const type = dayType(cell.iso, row)
                const day = Number(cell.iso.slice(8))
                const label = s.dayTitle(day, strings.monthsGenitive[month - 1], strings.kinds[type], row?.name)
                const className = `hc-cell ${TYPE_CLASS[type]}${cell.iso === today ? ' hc-today' : ''}`
                return onDayClick ? (
                  <button type="button" className={className} key={cell.iso} title={label} aria-label={label} onClick={() => onDayClick(cell.iso)}>
                    {day}
                  </button>
                ) : (
                  <div className={className} key={cell.iso} title={label}>
                    {day}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>
      <div className="hc-legend" role="group" aria-label={s.legend}>
        {LEGEND.map((type) => (
          <span className="hc-legend-item" key={type}>
            <span className={`hc-swatch ${TYPE_CLASS[type]}`} aria-hidden="true" />
            {strings.kinds[type]}
          </span>
        ))}
      </div>
    </div>
  )
}
