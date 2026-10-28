import { useEffect, useState } from 'react'
import { Alert, App, Button, DatePicker, Input, Segmented, Switch, Table, Tooltip } from 'antd'
import dayjs from 'dayjs'
import 'dayjs/locale/ru' // календарь с понедельника (локаль ru из ConfigProvider)
import { canRun } from '../../../core/access.js'
import { api } from '../../../core/api/index.js'
import { formatPrice } from '../../../core/format.js'
import strings from '../strings.js'
import './marking.css'

const s = strings.marking
const LISTS = ['withdraw', 'return', 'strange']
// длиннее — тяжёлый запрос к отчёту о реализации и нечитаемая лента дней
const MAX_DAYS = 31
const numberFormatter = new Intl.NumberFormat('ru-RU')
const dayLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
const weekday = (iso) => s.weekdays[(new Date(`${iso}T00:00:00`).getDay() + 6) % 7]
const fullDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('ru-RU')
// Последний день с данными — вчера; по умолчанию — прошлая неделя Пн–Сб (как сверяли раньше)
const LAST_DATE = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
const lastMonday = dayjs().subtract((dayjs().day() + 6) % 7 + 7, 'day')
const DEFAULT_PERIOD = { from: lastMonday.format('YYYY-MM-DD'), to: lastMonday.add(5, 'day').format('YYYY-MM-DD') }

function periodDays(from, to) {
  const days = []
  for (let d = dayjs(from); d.format('YYYY-MM-DD') <= to; d = d.add(1, 'day')) days.push(d.format('YYYY-MM-DD'))
  return days
}

function Kpi({ label, value, hint, accent }) {
  return (
    <div className={`mk-kpi${accent ? ' accent' : ''}`}>
      <span className="mk-kpi-label mono">{label}</span>
      <span className="mk-kpi-value">{value}</span>
      {hint && <span className="mk-kpi-hint">{hint}</span>}
    </div>
  )
}

// откуда взяты данные и по какую дату они есть
function Sources({ sources }) {
  return (
    <div className="mk-sources">
      {Object.entries(sources).map(([key, src]) => (
        <Tooltip key={key} title={src.table}>
          <span className={`mk-source mono${src.lastDate ? '' : ' off'}`}>
            <span className="mk-source-dot" />
            {s.sources[key]} · {src.lastDate ? s.sourceUntil(fullDate(src.lastDate)) : s.sourceEmpty}
          </span>
        </Tooltip>
      ))}
    </div>
  )
}

export default function MarkingTab({ access }) {
  const { message } = App.useApp()
  const [period, setPeriod] = useState(DEFAULT_PERIOD)
  const [version, setVersion] = useState(0) // «Пересчитать сверку» — тот же запрос заново
  const [result, setResult] = useState({ key: null, data: null, error: null })
  // номера документов «Честного ЗНАКа», которые сейчас редактируются (сохраняются по Enter или уходу с поля)
  const [documents, setDocuments] = useState({})
  const [list, setList] = useState('withdraw')
  const [day, setDay] = useState('all')
  const [onlyPending, setOnlyPending] = useState(false)
  const [query, setQuery] = useState('')

  const requestKey = `${period.from}|${period.to}|${version}`
  const loading = result.key !== requestKey
  const { data, error } = result
  useEffect(() => {
    let alive = true
    api
      .get(`/modules/wb/marking?from=${period.from}&to=${period.to}`)
      .then((d) => alive && setResult({ key: requestKey, data: d, error: null }))
      .catch((e) => alive && setResult((prev) => ({ key: requestKey, data: prev.data, error: e.message })))
    return () => {
      alive = false
    }
  }, [requestKey, period])

  const saveDocument = async (it) => {
    const document = (documents[it.key] ?? it.document).trim()
    if (document === it.document) return
    try {
      await api.post('/modules/wb/marking/document', { key: it.key, document })
      setResult((prev) => ({ ...prev, data: { ...prev.data, items: prev.data.items.map((x) => (x.key === it.key ? { ...x, document } : x)) } }))
      setDocuments((prev) => {
        const next = { ...prev }
        delete next[it.key]
        return next
      })
    } catch (e) {
      message.error(e.message)
    }
  }

  const items = data?.items ?? []
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
        value={documents[it.key] ?? it.document}
        onChange={(e) => setDocuments((prev) => ({ ...prev, [it.key]: e.target.value }))}
        onBlur={() => saveDocument(it)}
        onPressEnter={(e) => e.target.blur()}
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
          <Button onClick={() => setVersion((v) => v + 1)} loading={loading}>
            {s.refresh}
          </Button>
          <Button type="primary" onClick={() => message.info(s.notYet)}>
            ↓ {s.download}
          </Button>
        </div>
      </div>
      {error && <Alert type="error" showIcon message={error} />}
      {data && <Sources sources={data.sources} />}

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
        rowKey="key"
        loading={loading}
        pagination={{ pageSize: 20, showSizeChanger: false, hideOnSinglePage: true }}
        rowClassName={(it) => (it.list === 'strange' ? 'mk-row-issue' : pending(it) ? 'mk-row-wait' : '')}
        scroll={{ x: 960 }}
      />
    </div>
  )
}
