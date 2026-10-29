import { useState } from 'react'
import { Spin } from 'antd'
import { addDays, todayIso } from '../../../core/dates.js'
import { UPCOMING_DAYS, monthKey, upcomingBirthdays } from '../lib/birthdays.js'
import { useBirthdays } from '../lib/useBirthdays.js'
import strings from '../strings.js'
import SectionHead from '../../../core/layout/SectionHead.jsx'

const s = strings.birthdays

const whenLabel = (inDays) => (inDays === 0 ? s.today : inDays === 1 ? s.tomorrow : s.inDays(inDays))

// Блок главной (HOME_WIDGETS): дни рождения на ближайшую неделю. Только день и месяц, без возраста.
export default function HomeBirthdays() {
  const [today] = useState(todayIso)
  const entries = useBirthdays([monthKey(today), monthKey(addDays(today, UPCOMING_DAYS))], true)
  const list = entries ? upcomingBirthdays(entries, today) : []

  return (
    <section className="home-block tight" aria-labelledby="home-birthdays">
      <SectionHead id="home-birthdays" title={s.title} />
      {entries === null ? (
        <Spin size="small" />
      ) : list.length === 0 ? (
        <div className="people-empty">{s.empty}</div>
      ) : (
        <div>
          {list.map((b) => (
            <div className="people-row" key={`${b.personId}|${b.date}`}>
              <span className="people-name">{b.name}</span>
              <span className={`people-when${b.inDays === 0 ? ' today' : ''}`}>{whenLabel(b.inDays)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
