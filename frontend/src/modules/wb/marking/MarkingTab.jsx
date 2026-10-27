import { useMemo, useState } from 'react'
import { App, Button, DatePicker, Input, Segmented, Switch, Table, Tooltip } from 'antd'
import dayjs from 'dayjs'
import 'dayjs/locale/ru' // календарь с понедельника (локаль ru из ConfigProvider)
import { canRun } from '../../../core/access.js'
import { formatDateTime, formatPrice } from '../../../core/format.js'
import strings from '../strings.js'
import { DEFAULT_PERIOD, LAST_DATE, demoPeriod, periodDays } from './demoData.js'
import './marking.css'

const s = strings.marking
const LISTS = ['withdraw', 'return', 'strange']
// длиннее — тяжёлый запрос к отчёту о реализации и нечитаемая лента дней
const MAX_DAYS = 31
const numberFormatter = new Intl.NumberFormat('ru-RU')
const dayLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
const weekday = (iso) => s.weekdays[(new Date(`${iso}T00:00:00`).getDay() + 6) % 7]

function Kpi({ label, value, hint, accent }) {
  return (
    <div className={`mk-kpi${accent ? ' accent' : ''}`}>
      <span className="mk-kpi-label mono">{label}</span>
      <span className="mk-kpi-value">{value}</span>
      {hint && <span className="mk-kpi-hint">{hint}</span>}
    </div>
  )
}

// откуда взяты данные и когда таблица обновлялась последний раз
function Sources({ sources }) {
  return (
    <div className="mk-sources">
      {Object.entries(sources).map(([key, src]) => (
        <Tooltip key={key} title={src.table}>
          <span className={`mk-source mono${src.updatedAt ? '' : ' off'}`}>
            <span className="mk-source-dot" />
            {s.sources[key]} · {src.updatedAt ? formatDateTime(src.updatedAt) : s.sourceEmpty}
          </span>
        </Tooltip>
      ))}
    </div>
  )
}

export default function MarkingTab({ access }) {
  const { message } = App.useApp()
  const [period, setPeriod] = useState(DEFAULT_PERIOD)
  const data = useMemo(() => demoPeriod(period.from, period.to), [period])
  // номера документов «Честного ЗНАКа», введённые на странице (в демо — только в памяти)
  const [documents, setDocuments] = useState({})
  const [list, setList] = useState('withdraw')
  const [day, setDay] = useState('all')
  const [onlyPending, setOnlyPending] = useState(false)
  const [query, setQuery] = useState('')

  const items = data.items.map((it) => ({ ...it, document: documents[it.key] ?? it.document }))
  const pending = (it) => it.list !== 'strange' && !it.document
  const byList = Object.fromEntries(LISTS.map((l) => [l, items.filter((it) => it.list === l)]))
  const days = periodDays(period.from, period.to)
  const withdrawPending = byList.withdraw.filter(pending)

  const pickPeriod = (range) => {
    if (!range?.[0] || !range?.[1]) return
    setPeriod({ from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD') })
    setDay('all')
  }
  // нельзя выбрать будущее и период длиннее MAX_DAYS
  const disabledDate = (current, { from }) =>
    current.format('YYYY-MM-DD') > LAST_DATE || Boolean(from && Math.abs(current.diff(from, 'day')) >= MAX_DAYS)

  const q = query.trim().toLowerCase()
  const rows = byList[list].filter(
    (it) =>
      (day === 'all' || it.date === day) &&
      (!onlyPending || pending(it)) &&
      (!q || String(it.nm_id).includes(q) || it.sa_name.includes(q) || it.km.toLowerCase().includes(q)),
  )
  const maxDay = Math.max(...days.map((d) => byList[list].filter((it) => it.date === d).length), 1)

  const documentCell = (it) =>
    canRun(access) ? (
      <Input
        size="small"
        className="mono"
        placeholder={s.documentPlaceholder}
        value={it.document}
        onChange={(e) => setDocuments((prev) => ({ ...prev, [it.key]: e.target.value }))}
        style={{ width: 130 }}
      />
    ) : (
      <span className="mono">{it.document || '—'}</span>
    )

  const columns = [
    { title: s.columns.date, dataIndex: 'date', width: 70, render: (v) => <span className="mono">{dayLabel(v)}</span> },
    {
      title: s.columns.article,
      dataIndex: 'nm_id',
      render: (v, it) => (
        <div className="mk-article">
          <span className="mono">{v}</span>
          <span className="mk-muted">
            {it.sa_name} · {it.title}
          </span>
        </div>
      ),
    },
    { title: s.columns.code, dataIndex: 'km', render: (v) => <span className="mono mk-code">{v}</span> },
    {
      title: s.columns.assembly,
      dataIndex: 'assembly_id',
      render: (v) => (v ? <span className="mono">{v}</span> : <span className="mk-missing">{s.noAssembly}</span>),
    },
    { title: s.columns.price, dataIndex: 'price', align: 'right', render: (v) => <span className="mono">{formatPrice(v)}</span> },
  ]
  if (list === 'strange') {
    columns.push({ title: s.columns.reason, dataIndex: 'reason', render: (v) => <span className="mk-reason">{s.reasons[v]}</span> })
  } else {
    columns.push(
      { title: list === 'withdraw' ? s.columns.document : s.columns.returnDocument, dataIndex: 'document', render: (_, it) => documentCell(it) },
      {
        title: s.columns.status,
        key: 'status',
        render: (_, it) => (
          <span className={`mk-status ${it.document ? 'st-ok' : 'st-wait'}`}>
            <span className="mk-status-dot" />
            {it.document ? s.statuses[list].done : s.statuses[list].wait}
          </span>
        ),
      },
    )
  }

  return (
    <div className="mk">
      <div className="mk-bar">
        <div className="mk-week">
          <span className="mk-week-label">{s.period}</span>
          <DatePicker.RangePicker
            allowClear={false}
            format="DD.MM.YYYY"
            value={[dayjs(period.from), dayjs(period.to)]}
            onChange={pickPeriod}
            disabledDate={disabledDate}
            aria-label={s.pickPeriod}
          />
        </div>
        <div className="mk-actions">
          {canRun(access) && <Button onClick={() => message.info(s.notYet)}>{s.refresh}</Button>}
          <Button type="primary" onClick={() => message.info(s.notYet)}>
            ↓ {s.download}
          </Button>
        </div>
      </div>
      <Sources sources={data.sources} />

      <div className="mk-kpis">
        <Kpi
          label={s.kpi.toWithdraw}
          value={numberFormatter.format(withdrawPending.length)}
          hint={formatPrice(withdrawPending.reduce((acc, it) => acc + it.price, 0))}
          accent={withdrawPending.length > 0}
        />
        <Kpi
          label={s.kpi.withdrawn}
          value={numberFormatter.format(byList.withdraw.length - withdrawPending.length)}
          hint={s.kpi.ofPeriod(byList.withdraw.length)}
        />
        <Kpi
          label={s.kpi.returns}
          value={numberFormatter.format(byList.return.length)}
          hint={s.kpi.pendingReturns(byList.return.filter(pending).length)}
        />
        <Kpi
          label={s.kpi.strange}
          value={numberFormatter.format(byList.strange.length)}
          hint={s.kpi.strangeHint}
          accent={byList.strange.length > 0}
        />
      </div>

      <Segmented
        value={list}
        onChange={(v) => {
          setList(v)
          setOnlyPending(false)
        }}
        options={LISTS.map((l) => ({ value: l, label: `${s.lists[l]} · ${byList[l].length}` }))}
      />

      <div className="mk-days">
        {days.map((d) => {
          const dayItems = byList[list].filter((it) => it.date === d)
          const waiting = dayItems.filter(pending).length
          return (
            <button type="button" key={d} className={`mk-day${day === d ? ' active' : ''}`} onClick={() => setDay(day === d ? 'all' : d)}>
              <span className="mk-day-head mono">
                {weekday(d)} · {dayLabel(d)}
              </span>
              <span className="mk-day-count">{dayItems.length}</span>
              <span className="mk-day-bar">
                <span style={{ width: `${(dayItems.length / maxDay) * 100}%` }} />
              </span>
              <span className={`mk-day-issues mono${waiting || (list === 'strange' && dayItems.length) ? ' has' : ''}`}>
                {list === 'strange' ? s.checkThem : waiting ? s.waitingCount(waiting) : s.allDone}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mk-filters">
        <Input.Search allowClear placeholder={s.search} value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 300 }} />
        {list !== 'strange' && (
          <label className="mk-switch">
            <Switch size="small" checked={onlyPending} onChange={setOnlyPending} /> {s.onlyPending}
          </label>
        )}
        {day !== 'all' && (
          <Button size="small" type="link" onClick={() => setDay('all')}>
            {s.allPeriod}
          </Button>
        )}
        <span className="counter mono">[{String(rows.length).padStart(2, '0')}]</span>
      </div>

      <Table
        size="small"
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 20, showSizeChanger: false, hideOnSinglePage: true }}
        rowClassName={(it) => (it.list === 'strange' ? 'mk-row-issue' : pending(it) ? 'mk-row-wait' : '')}
        scroll={{ x: 960 }}
      />
      <div className="mk-demo-note mono">{s.demoNote}</div>
    </div>
  )
}
