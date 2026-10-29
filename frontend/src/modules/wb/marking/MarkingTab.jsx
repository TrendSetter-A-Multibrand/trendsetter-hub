import { useEffect, useState } from 'react'
import { Alert, App, Button, DatePicker, Input, Table, Tooltip } from 'antd'
import dayjs from 'dayjs'
import 'dayjs/locale/ru' // календарь с понедельника (локаль ru из ConfigProvider)
import { canRun } from '../../../core/access.js'
import { api } from '../../../core/api/index.js'
import { formatPrice } from '../../../core/format.js'
import strings from '../strings.js'
import PageHead from '../../../core/layout/PageHead.jsx'
import SectionHead from '../../../core/layout/SectionHead.jsx'
import ImportModal from './ImportModal.jsx'
import { chzSheet, exportSheets } from './xlsx.js'
import './marking.css'

const s = strings.marking
const LISTS = ['withdraw', 'return', 'strange']
// раньше этой даты отчёты FBS и маркировки не сверяем (как на бэкенде)
const MIN_DATE = '2026-08-01'
const numberFormatter = new Intl.NumberFormat('ru-RU')
const dayLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
const weekday = (iso) => s.weekdays[(new Date(`${iso}T00:00:00`).getDay() + 6) % 7]
const fullDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('ru-RU')
// Последний день с данными — вчера; по умолчанию — прошлая неделя Пн–Сб (как сверяли раньше)
const LAST_DATE = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
const lastMonday = dayjs().subtract((dayjs().day() + 6) % 7 + 7, 'day')
const DEFAULT_PERIOD = { from: lastMonday.format('YYYY-MM-DD'), to: lastMonday.add(5, 'day').format('YYYY-MM-DD') }
const PRESETS = [
  { label: s.presets.lastWeek, value: [lastMonday, lastMonday.add(5, 'day')] },
  { label: s.presets.thisMonth, value: [dayjs().startOf('month'), dayjs(LAST_DATE)] },
  { label: s.presets.sinceAugust, value: [dayjs(MIN_DATE), dayjs(LAST_DATE)] },
]

function periodDays(from, to) {
  const days = []
  for (let d = dayjs(from); d.format('YYYY-MM-DD') <= to; d = d.add(1, 'day')) days.push(d.format('YYYY-MM-DD'))
  return days
}

// accent: 'marker' — жёлтая плашка на цифре (нужно действие), 'red' — красная цифра (проверить вручную)
function Kpi({ label, value, hint, accent }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span>
        <span className={`kpi-value${accent === 'marker' ? ' marker' : accent === 'red' ? ' mk-red' : ''}`}>{value}</span>
      </span>
      {hint && <span className="kpi-sub">{hint}</span>}
    </div>
  )
}

// откуда взяты данные и по какую дату они есть
function Sources({ sources }) {
  return (
    <div className="mk-sources">
      {Object.entries(sources).map(([key, src]) => (
        <Tooltip key={key} title={src.table}>
          <span className={`mk-source${src.lastDate ? '' : ' off'}`}>
            <span className="mk-source-dot" />
            {s.sources[key]} · {src.lastDate ? s.sourceUntil(fullDate(src.lastDate)) : s.sourceEmpty}
          </span>
        </Tooltip>
      ))}
    </div>
  )
}

export default function MarkingTab({ module, access }) {
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
  const [importOpen, setImportOpen] = useState(false)
  const [bulkDocument, setBulkDocument] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)

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
  // нельзя выбрать будущее и даты раньше MIN_DATE
  const disabledDate = (current) => {
    const d = current.format('YYYY-MM-DD')
    return d > LAST_DATE || d < MIN_DATE
  }

  // все строки периода тремя листами, как в прежней сводной таблице
  const download = async () => {
    const XLSX = await import('xlsx')
    const book = XLSX.utils.book_new()
    for (const { name, rows } of exportSheets(items, s)) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name)
    XLSX.writeFile(book, s.exportName(period.from, period.to))
  }

  // Неоформленные строки, которые сейчас в таблице: файл для загрузки в «Честный ЗНАК» и один номер документа на все
  const pendingRows = () => rows.filter(pending)
  const downloadChz = async () => {
    const XLSX = await import('xlsx')
    const { name, rows: sheet } = chzSheet(list, pendingRows())
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sheet), name)
    XLSX.writeFile(book, s.chz.fileName(list, day === 'all' ? `${period.from}_${period.to}` : day))
  }
  const applyDocument = async () => {
    const targets = pendingRows()
    const document = bulkDocument.trim()
    setBulkBusy(true)
    try {
      await api.post('/modules/wb/marking/documents', { keys: targets.map((it) => it.key), document })
      const keys = new Set(targets.map((it) => it.key))
      setResult((prev) => ({ ...prev, data: { ...prev.data, items: prev.data.items.map((x) => (keys.has(x.key) ? { ...x, document } : x)) } }))
      setBulkDocument('')
      message.success(s.chz.applied(targets.length, document))
    } catch (e) {
      message.error(e.message)
    } finally {
      setBulkBusy(false)
    }
  }

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
    { title: s.tableColumns.date, dataIndex: 'date', width: 70, render: (v) => <span className="mono">{dayLabel(v)}</span> },
    {
      title: s.tableColumns.article,
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
    { title: s.tableColumns.code, dataIndex: 'km', render: (v) => <span className="mono mk-code">{v}</span> },
    {
      title: s.tableColumns.assembly,
      dataIndex: 'assembly_id',
      render: (v) => (v ? <span className="mono">{v}</span> : <span className="mk-missing">{s.noAssembly}</span>),
    },
    { title: s.tableColumns.price, dataIndex: 'price', align: 'right', render: (v) => <span className="mono">{formatPrice(v)}</span> },
  ]
  if (list === 'strange') {
    columns.push({ title: s.tableColumns.reason, dataIndex: 'reason', render: (v) => <span className="mk-reason">{s.reasons[v]}</span> })
  } else {
    columns.push(
      { title: s.tableColumns.document, dataIndex: 'document', render: (_, it) => documentCell(it) },
      {
        title: s.tableColumns.status,
        key: 'status',
        render: (_, it) => (
          <span className={`mk-status ${it.document ? 'st-ok' : 'st-wait'}`}>{it.document ? s.statuses[list].done : s.statuses[list].wait}</span>
        ),
      },
    )
  }

  const section = module.strings.sections.marking
  const total = byList[list].length

  return (
    <div className="stack module mk">
      <PageHead module={module} title={section.label} subtitle={section.description}>
        <Button onClick={() => setVersion((v) => v + 1)} loading={loading}>
          {s.refresh}
        </Button>
        {canRun(access) && <Button onClick={() => setImportOpen(true)}>↑ {s.upload}</Button>}
        <Button type="primary" disabled={!data} onClick={download}>
          ↓ {s.download}
        </Button>
      </PageHead>
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={() => setVersion((v) => v + 1)} />

      <div className="mk-bar">
        <DatePicker.RangePicker
          allowClear={false}
          format="DD.MM.YYYY"
          value={[dayjs(period.from), dayjs(period.to)]}
          onChange={pickPeriod}
          disabledDate={disabledDate}
          presets={PRESETS}
          aria-label={s.pickPeriod}
        />
        {data && <Sources sources={data.sources} />}
      </div>
      {error && <Alert type="error" showIcon message={error} />}

      <section className="section" aria-labelledby="mk-sum">
        <SectionHead id="mk-sum" title={s.summaryTitle} />
        <div className="kpis">
          <Kpi
            label={s.kpi.toWithdraw}
            value={numberFormatter.format(withdrawPending.length)}
            hint={formatPrice(withdrawPending.reduce((acc, it) => acc + it.price, 0))}
            accent={withdrawPending.length > 0 ? 'marker' : null}
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
            accent={byList.strange.length > 0 ? 'red' : null}
          />
        </div>
      </section>

      <section className="section" aria-labelledby="mk-days">
        <SectionHead id="mk-days" title={s.daysTitle}>
          <span className="seg" role="tablist" aria-label={s.listLabel}>
            {LISTS.map((l) => (
              <button
                key={l}
                type="button"
                role="tab"
                className="seg-btn"
                aria-selected={list === l}
                onClick={() => {
                  setList(l)
                  setOnlyPending(false)
                }}
              >
                {s.tabs[l]} · {byList[l].length}
              </button>
            ))}
          </span>
        </SectionHead>
        <div className="mk-days">
          {days.map((d) => {
            const dayItems = byList[list].filter((it) => it.date === d)
            const waiting = dayItems.filter(pending).length
            const issue = waiting || (list === 'strange' && dayItems.length)
            const done = dayItems.length - waiting
            return (
              <button type="button" key={d} aria-pressed={day === d} className={`mk-day${day === d ? ' active' : ''}`} onClick={() => setDay(day === d ? 'all' : d)}>
                <span className="mk-day-head">
                  {weekday(d)} · {dayLabel(d)}
                </span>
                <span className="mk-day-count">{dayItems.length}</span>
                <span className="mk-day-bar" aria-hidden="true">
                  <span className={issue ? 'wait' : ''} style={{ width: `${list === 'strange' ? (dayItems.length / maxDay) * 100 : dayItems.length ? (done / dayItems.length) * 100 : 0}%` }} />
                </span>
                <span className={`mk-day-issues${issue ? ' has' : ''}`}>
                  {list === 'strange' ? s.checkThem : waiting ? s.waitingCount(waiting) : s.allDone}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="section" aria-labelledby="mk-codes">
        <SectionHead id="mk-codes" title={s.codesTitle(rows.length, total)} />
        <div className="mk-filters">
          <Input.Search allowClear placeholder={s.search} aria-label={s.search} value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: '1 1 260px', maxWidth: 360 }} />
          {list !== 'strange' && (
            <button type="button" role="switch" aria-checked={onlyPending} className="sq-switch" onClick={() => setOnlyPending((v) => !v)}>
              <span className="sq-switch-track" aria-hidden="true">
                <span className="sq-switch-knob" />
              </span>
              {s.onlyPending}
            </button>
          )}
          {day !== 'all' && (
            <button type="button" className="seg-btn mk-chip" aria-pressed="true" onClick={() => setDay('all')}>
              {s.dayChip(dayLabel(day))}
            </button>
          )}
          {list !== 'strange' && rows.some(pending) && (
            <span className="mk-chz">
              <Tooltip title={s.chz.hint}>
                <Button onClick={downloadChz}>{s.chz.download(rows.filter(pending).length)}</Button>
              </Tooltip>
              {canRun(access) && (
                <>
                  <Input
                    className="mono"
                    placeholder={s.chz.documentPlaceholder}
                    aria-label={s.chz.documentPlaceholder}
                    value={bulkDocument}
                    onChange={(e) => setBulkDocument(e.target.value)}
                    onPressEnter={() => bulkDocument.trim() && applyDocument()}
                    style={{ width: 170 }}
                  />
                  <Button disabled={!bulkDocument.trim()} loading={bulkBusy} onClick={applyDocument}>
                    {s.chz.apply(rows.filter(pending).length)}
                  </Button>
                </>
              )}
            </span>
          )}
        </div>
        <Table
          size="small"
          columns={columns}
          dataSource={rows}
          rowKey="key"
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false, hideOnSinglePage: true }}
          rowClassName={(it) => (it.list === 'strange' ? 'mk-row-issue' : '')}
          scroll={{ x: 980 }}
        />
      </section>
    </div>
  )
}
