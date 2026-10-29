import { Alert, Skeleton } from 'antd'
import { formatDate } from '../../../../core/dates.js'
import SectionHead from '../../../../core/layout/SectionHead.jsx'
import strings from '../../strings.js'
import { formatTenure, toDonutItems } from '../../lib/stats.js'
import { BarList, Columns, Donut, Kpi, MixBar, Split, Waffle } from './charts.jsx'

const s = strings.stats
const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

// Квадрат 8×8 цвета направления + короткое название моно-капсом
function DirMark({ d }) {
  if (!d) return null
  return (
    <span className="hr-dir">
      <span className="hr-sq" style={{ background: d.color }} aria-hidden="true" />
      {d.shortName}
    </span>
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
  const metaOf = (source, dist) => [source, s.known(dist.known, total)].filter(Boolean).join(' · ')
  // Вид графика под задачу: кольцо/числа/сетка — доли 2–3 групп, полоса — неравные доли, столбики — порядковые группы
  const chart = (Chart, title, source, dist, lab, props) => (
    <Chart title={title} meta={metaOf(source, dist)} items={toDonutItems(dist.items, lab)} {...props} />
  )
  const ordinal = (title, dist, lab, color) => (
    <Columns
      title={title}
      meta={metaOf(s.charts.dossierSource, dist)}
      items={dist.items.map((i) => ({ label: lab(i), value: i.count }))}
      color={color}
    />
  )
  const leaveRow = (l) => {
    const d = new Date(`${l.start}T00:00:00`)
    return (
      <div key={l.personId} className="hr-leave-card">
        <span className="hr-leave-date">
          <span className="hr-leave-day">{d.getDate()}</span>
          <span className="hr-leave-mon">{MONTHS[d.getMonth()]}</span>
        </span>
        <span className="hr-leave-text">
          <span className="hr-leave-name">{l.name}</span>
          <span className="hr-leave-sub">
            {strings.leave.kinds[l.kind] ?? l.kind} · {formatDate(l.start)} – {formatDate(l.end)}
          </span>
        </span>
      </div>
    )
  }

  return (
    <div className="stack">
      <section className="section" aria-labelledby="hr-sum">
        <SectionHead id="hr-sum" title={s.title}>
          <span className="sec-note">{s.asOf(formatDate(stats.asOf))}</span>
        </SectionHead>
        <div className="hr-kpis">
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
          <Kpi title={c.leaveNow} value={leaveNow.length} sub={c.leaveNowSub(stats.leave.soon.length, stats.leave.soonDays)} hint={leaveHint || c.leaveNowHint} />
          <Kpi
            title={c.avgAge}
            value={average === null ? strings.none : String(average).replace('.', ',')}
            sub={average === null ? s.fewData : s.yearsUnit}
            hint={c.avgAgeHint}
          />
          <Kpi
            title={c.avgTenure}
            value={averageMonths === null ? strings.none : formatTenure(averageMonths)}
            sub={averageMonths === null ? s.fewData : s.inCompany}
            hint={c.avgTenureHint}
          />
        </div>
      </section>

      <section className="section" aria-labelledby="hr-mix">
        <SectionHead id="hr-mix" title={s.mixTitle}>
          <span className="sec-note">{s.mixNote}</span>
        </SectionHead>
        <div className="hr-mix-grid">
          <div className="hr-span-2">{chart(Donut, s.charts.location, s.charts.locationSource, stats.location, labelOf)}</div>
          <div className="hr-span-2">{chart(Donut, s.charts.workFormat, s.charts.workFormatSource, stats.workFormat, labelOf)}</div>
          <div className="hr-span-2">{chart(Split, s.charts.country, s.charts.countrySource, stats.country, keyed(strings.policies.countries))}</div>
          <div className="hr-span-3">{chart(Waffle, s.charts.gender, s.charts.genderSource, stats.gender, keyed(s.gender))}</div>
          <div className="hr-span-3">
            {chart(MixBar, s.charts.employmentType, s.charts.employmentTypeSource, stats.employmentType, keyed(strings.dossier.employmentTypes))}
          </div>
          <div className="hr-span-3">{ordinal(s.charts.age, { known: stats.age.known, items: stats.age.buckets }, keyed(s.age))}</div>
          <div className="hr-span-3">
            {ordinal(s.charts.tenure, { known: stats.tenure.known, items: stats.tenure.buckets }, keyed(s.tenure), 'var(--data-2)')}
          </div>
        </div>
      </section>

      <div className="hr-cols">
        <section className="section" aria-labelledby="hr-dir">
          <SectionHead id="hr-dir" title={s.lists.byDirection} />
          <BarList
            rows={stats.directions.map((d) => ({
              label: directionOf(d.id)?.shortName ?? d.id,
              value: d.count,
              color: directionOf(d.id)?.color ?? 'var(--data-7)',
              total,
            }))}
          />
        </section>
        <section className="section hr-tight" aria-labelledby="hr-mgr">
          <SectionHead id="hr-mgr" title={s.lists.managers} />
          <div>
            {stats.managers.top.map((m) => (
              <div key={m.personId} className="hr-mgr-row">
                <span className="hr-mgr-name">{m.name}</span>
                <DirMark d={directionOf(m.directionId)} />
                <span className="hr-mgr-n" aria-label={`${m.reports} ${s.lists.managersReports}`}>
                  {m.reports}
                </span>
              </div>
            ))}
          </div>
        </section>
        <section className="section hr-tight" aria-labelledby="hr-vac">
          <SectionHead id="hr-vac" title={s.lists.leave} />
          <span className="hr-vac-label">{s.lists.leaveNow}</span>
          {leaveNow.length === 0 ? <span className="hr-vac-empty">{s.lists.allHere}</span> : leaveNow.map(leaveRow)}
          <span className="hr-vac-label">{s.lists.leaveSoon}</span>
          {stats.leave.soon.length === 0 ? <span className="hr-vac-empty">{s.lists.empty}</span> : stats.leave.soon.map(leaveRow)}
        </section>
      </div>
    </div>
  )
}

export default function PeopleStats({ stats, error, directions }) {
  if (stats) return <Body stats={stats} directions={directions} />
  if (error) return <Alert type="error" showIcon title={s.loadFailed} description={error} />
  return <Skeleton />
}
