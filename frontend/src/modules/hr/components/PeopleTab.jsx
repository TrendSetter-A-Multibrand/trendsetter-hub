import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Alert, App, Button, Collapse, Dropdown, Input, Modal, Select, Space, Spin, Table, Tag, Typography } from 'antd'
import { api } from '../../../core/api/index.js'
import coreStrings from '../../../core/strings.js'
import { softDirections } from '../../../core/palette.js'
import strings from '../strings.js'
import { useLoad } from '../lib/useLoad.js'
import { managerOptions, personName } from '../lib/options.js'
import { completeness, levelOf } from '../lib/completeness.js'
import { useAutoChecklist } from '../lib/useAutoChecklist.js'
import AutoChecklistOption from './AutoChecklistOption.jsx'
import PersonModal from './PersonModal.jsx'
import PeopleStats from './stats/PeopleStats.jsx'
import ExportButton from './ExportButton.jsx'
import SectionHead from '../../../core/layout/SectionHead.jsx'

const s = strings.people
const BASE = '/modules/team/hr'
const MODE_KEY = 'hr.people.mode'
const MODES = Object.keys(s.modes)
const CARDS_STEP = 24

const loadMode = () => {
  try {
    const v = localStorage.getItem(MODE_KEY)
    return MODES.includes(v) ? v : 'table'
  } catch {
    return 'table'
  }
}
const saveMode = (v) => {
  try {
    localStorage.setItem(MODE_KEY, v)
  } catch {
    // режим просто не запомнится
  }
}

// Направление: квадрат 8×8 цвета направления и короткое название моно-капсом
function DirTag({ d }) {
  return d ? (
    <span className="hr-dir">
      <span className="hr-sq" style={{ background: d.color }} aria-hidden="true" />
      {d.shortName}
    </span>
  ) : (
    strings.none
  )
}

const LEVEL_COLOR = { success: 'var(--status-success)', warning: '#C9A227', error: '#A22325', default: 'var(--text-secondary)' }

// Процент заполненности; весь тег — кнопка. Уволенные — без цветового акцента.
function FillTag({ fill, person, onOpen }) {
  if (!fill) return strings.none
  const level = person.isArchived ? 'default' : levelOf(fill.percent)
  return (
    <button type="button" className="hr-fill" aria-label={s.fillPercent(fill.percent)} onClick={() => onOpen(person)}>
      <span className="hr-fill-track" aria-hidden="true">
        <span style={{ width: `${fill.percent}%`, background: LEVEL_COLOR[level] ?? LEVEL_COLOR.default }} />
      </span>
      <span className="hr-fill-num">{fill.percent}%</span>
    </button>
  )
}

function FillModal({ person, fill, onClose, onEdit }) {
  return (
    <Modal
      open
      title={s.fillTitle(person.name)}
      onCancel={onClose}
      footer={
        <Button type="primary" onClick={onEdit}>
          {s.editCard}
        </Button>
      }
    >
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        {s.fillPercent(fill.percent)}
      </Typography.Title>
      {fill.missing.length === 0 ? (
        <Typography.Text type="secondary">{s.fillComplete}</Typography.Text>
      ) : (
        <>
          <Typography.Text strong>{s.fillMissing}</Typography.Text>
          <ul style={{ margin: '4px 0 0' }}>
            {fill.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  )
}

// Подтверждение «Отметить уволенным». Если у человека есть подчинённые, backend отвечает 409 — переходим к переназначению (выбор автозапуска переносится).
function ArchiveModal({ person, onClose, onDone, onNeedReassign }) {
  const { message } = App.useApp()
  const auto = useAutoChecklist('offboarding')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    try {
      await api.patch(`${BASE}/people/${person.id}`, { isArchived: true })
      message.success(s.archived)
      await onDone(await auto.run(person.id))
    } catch (e) {
      if (e.status === 409 && person.directReports > 0) onNeedReassign({ enabled: auto.enabled, templateId: auto.templateId })
      else message.error(e.message)
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={s.archive}
      okText={s.archive}
      okButtonProps={{ danger: true }}
      cancelText={coreStrings.cancel}
      confirmLoading={saving}
      onCancel={onClose}
      onOk={submit}
    >
      <Typography.Paragraph>{s.archiveConfirm(person.name)}</Typography.Paragraph>
      <AutoChecklistOption auto={auto} />
    </Modal>
  )
}

function ReassignModal({ person, people, initialAuto, onClose, onDone }) {
  const { message } = App.useApp()
  const auto = useAutoChecklist('offboarding', { initialEnabled: initialAuto.enabled, initialTemplateId: initialAuto.templateId })
  const [target, setTarget] = useState(null)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (target === null) return message.error(s.reassignRequired)
    setSaving(true)
    try {
      await api.patch(`${BASE}/people/${person.id}`, { isArchived: true, reassignTo: target })
      message.success(s.archived)
      await onDone(await auto.run(person.id))
    } catch (e) {
      message.error(e.message)
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={s.reassignTitle(person.name)}
      okText={s.reassignOk}
      cancelText={coreStrings.cancel}
      confirmLoading={saving}
      onCancel={onClose}
      onOk={submit}
    >
      <Typography.Paragraph>{s.reassignText}</Typography.Paragraph>
      <Typography.Text strong>{s.reassignTo}</Typography.Text>
      <Select
        showSearch
        optionFilterProp="label"
        style={{ width: '100%', marginTop: 4, marginBottom: 14 }}
        value={target}
        onChange={setTarget}
        options={managerOptions(people, [person.id])}
      />
      <AutoChecklistOption auto={auto} />
    </Modal>
  )
}

function PeopleTable({ people, directions, reload, stats, statsError, actionsEl }) {
  const { message } = App.useApp()
  const { data: fields } = useLoad(`${BASE}/fields`)
  const { data: users } = useLoad(`${BASE}/users`)
  const [query, setQuery] = useState('')
  const [dirFilter, setDirFilter] = useState(null)
  const [view, setView] = useState('active')
  const [mode, setModeState] = useState(loadMode)
  const [shown, setShown] = useState(CARDS_STEP)
  const [modal, setModal] = useState(null) // { person?, fromUser?, initialTab? }
  const [archiving, setArchiving] = useState(null) // person
  const [reassign, setReassign] = useState(null) // { person, initialAuto }
  const [fillOf, setFillOf] = useState(null) // person

  const setMode = (v) => {
    setModeState(v)
    saveMode(v)
  }

  const dirById = useMemo(() => Object.fromEntries(directions.map((d) => [d.id, d])), [directions])
  const fills = useMemo(() => (fields ? Object.fromEntries(people.map((p) => [p.id, completeness(fields, p)])) : {}), [fields, people])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return people.filter((p) => {
      if (view === 'active' && p.isArchived) return false
      if (view === 'hidden' && (p.showInMap || p.isArchived)) return false
      if (view === 'archived' && !p.isArchived) return false
      if (dirFilter && p.directionId !== dirFilter) return false
      if (!q) return true
      return [p.name, p.title, p.email, p.team, p.tag].filter(Boolean).join(' ').toLowerCase().includes(q)
    })
  }, [people, query, dirFilter, view])

  const groups = useMemo(() => {
    const out = directions.map((d) => ({ key: d.id, d, items: rows.filter((p) => p.directionId === d.id) }))
    const rest = rows.filter((p) => !dirById[p.directionId])
    if (rest.length) out.push({ key: 'none', d: null, items: rest })
    return out.filter((g) => g.items.length)
  }, [rows, directions, dirById])

  const patch = async (person, body, okText) => {
    try {
      await api.patch(`${BASE}/people/${person.id}`, body)
      message.success(okText)
      await reload()
    } catch (e) {
      message.error(e.message)
    }
  }

  // после увольнения: если оффбординг запущен — сообщение со ссылкой на чек-листы сотрудника
  const afterArchive = async (person, result) => {
    setArchiving(null)
    setReassign(null)
    await reload()
    if (result.status !== 'started') return
    const key = `offboarding-${person.id}`
    message.success({
      key,
      duration: 8,
      content: (
        <span>
          {strings.autoChecklist.offboardingStarted}{' '}
          <Button
            type="link"
            size="small"
            onClick={() => {
              message.destroy(key)
              setModal({ person, initialTab: 'checklists' })
            }}
          >
            {strings.autoChecklist.openChecklists}
          </Button>
        </span>
      ),
    })
  }

  const mapSwitch = (p) => (
    <button
      type="button"
      role="switch"
      className="sq-switch"
      aria-checked={p.showInMap}
      aria-label={`${s.showInMap}: ${p.name}`}
      disabled={p.isArchived}
      onClick={() => patch(p, { showInMap: !p.showInMap }, !p.showInMap ? s.shownInMap : s.hiddenInMap)}
    >
      <span className="sq-switch-track" aria-hidden="true">
        <span className="sq-switch-knob" />
      </span>
    </button>
  )

  // опасное действие спрятано в меню «⋯», чтобы не нажать случайно
  const actionButtons = (p, short) => (
    <Space.Compact>
      {p.isArchived && !short && <Tag>{s.archivedTag}</Tag>}
      <Button size="small" onClick={() => setModal({ person: p })}>
        {s.edit}
      </Button>
      <Dropdown
        trigger={['click']}
        menu={{
          items: p.isArchived
            ? [{ key: 'restore', label: s.restore, onClick: () => patch(p, { isArchived: false }, s.restored) }]
            : [{ key: 'archive', label: p.isCeo ? s.ceoLocked : s.archive, danger: true, disabled: p.isCeo, onClick: () => setArchiving(p) }],
        }}
      >
        <Button size="small" aria-label={s.moreActions} title={s.moreActions}>
          ⋯
        </Button>
      </Dropdown>
    </Space.Compact>
  )

  const fillTag = (p) => <FillTag fill={fills[p.id]} person={p} onOpen={setFillOf} />
  // Квадрат с инициалами (или фото, если есть)
  const avatar = (p, size = 36) => (
    <span className="hr-avatar" style={{ width: size, height: size }} aria-hidden="true">
      {p.thumb ? <img src={p.thumb} alt="" /> : p.name.split(' ').slice(0, 2).map((w) => w[0]).join('')}
    </span>
  )

  const columns = [
    {
      title: s.name,
      render: (_, p) => (
        <span className="hr-person">
          {avatar(p)}
          <span className="hr-person-text">
            <span className="hr-person-name">{p.name}</span>
            <span className="hr-person-role">{p.title}</span>
          </span>
        </span>
      ),
    },
    { title: s.direction, render: (_, p) => <DirTag d={dirById[p.directionId]} /> },
    { title: s.manager, render: (_, p) => personName(people, p.managerId) ?? strings.none },
    {
      title: s.teamTag,
      render: (_, p) => [p.team, p.tag].filter(Boolean).join(' / ') || strings.none,
    },
    { title: s.filled, render: (_, p) => fillTag(p) },
    { title: s.showInMap, render: (_, p) => mapSwitch(p) },
    { title: <span className="sr-only">{strings.actions}</span>, align: 'right', render: (_, p) => actionButtons(p) },
  ]

  const cardGrid = (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {rows.slice(0, shown).map((p) => (
          <div
            key={p.id}
            style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8, opacity: p.isArchived ? 0.75 : 1 }}
          >
            <Space align="start">
              {avatar(p, 48)}
              <div>
                <div style={{ fontWeight: 500 }}>{p.name}</div>
                <Typography.Text type="secondary">{p.title}</Typography.Text>
              </div>
            </Space>
            <Space wrap>
              <DirTag d={dirById[p.directionId]} />
              {fillTag(p)}
              {p.isArchived && <Tag>{s.archivedTag}</Tag>}
            </Space>
            <Space>
              {mapSwitch(p)}
              <Typography.Text type="secondary">{s.showInMap}</Typography.Text>
            </Space>
            {actionButtons(p, true)}
          </div>
        ))}
      </div>
      {rows.length > shown && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Button onClick={() => setShown((n) => n + CARDS_STEP)}>{s.showMore(rows.length - shown)}</Button>
        </div>
      )}
    </>
  )

  // при активном поиске группы раскрыты; без поиска свёрнуты
  const groupList = (
    <Collapse
      key={query ? 'q' : 'n'}
      defaultActiveKey={query ? groups.map((g) => g.key) : []}
      items={groups.map((g) => ({
        key: g.key,
        label: (
          <Space>
            <DirTag d={g.d} />
            <span>{g.d?.label ?? s.noDirection}</span>
            <Tag>{g.items.length}</Tag>
          </Space>
        ),
        children: g.items.map((p) => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0', opacity: p.isArchived ? 0.75 : 1 }}>
            {avatar(p, 28)}
            <div style={{ flex: 1, minWidth: 0 }}>
              <span>{p.name}</span> <Typography.Text type="secondary">{p.title}</Typography.Text>
            </div>
            {fillTag(p)}
            {mapSwitch(p)}
            {actionButtons(p, true)}
          </div>
        )),
      }))}
    />
  )

  const ready = fields && users
  return (
    <>
      {actionsEl &&
        createPortal(
          <>
            <ExportButton path="/modules/hr/export/people" />
            <Button type="primary" disabled={!ready} onClick={() => setModal({})}>
              + {s.add}
            </Button>
          </>,
          actionsEl,
        )}
      <PeopleStats stats={stats} error={statsError} directions={directions} />
      <section className="section hr-people" aria-labelledby="hr-people">
        <SectionHead id="hr-people" title={s.listTitle(rows.length)}>
          <span className="seg" role="group" aria-label={s.modeLabel}>
            {MODES.map((value) => (
              <button key={value} type="button" className="seg-btn" aria-pressed={mode === value} onClick={() => setMode(value)}>
                {s.modes[value]}
              </button>
            ))}
          </span>
        </SectionHead>
        <div className="hr-filters">
          <Input.Search
            allowClear
            placeholder={s.search}
            aria-label={s.search}
            style={{ flex: '1 1 240px', maxWidth: 340 }}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setShown(CARDS_STEP)
            }}
          />
          <Select
            allowClear
            placeholder={s.directionFilter}
            aria-label={s.directionFilter}
            style={{ width: 200 }}
            value={dirFilter}
            onChange={(v) => {
              setDirFilter(v ?? null)
              setShown(CARDS_STEP)
            }}
            options={directions.map((d) => ({ value: d.id, label: d.shortName }))}
          />
          <Select
            style={{ width: 200 }}
            aria-label={s.viewLabel}
            value={view}
            onChange={(v) => {
              setView(v)
              setShown(CARDS_STEP)
            }}
            options={Object.entries(s.viewFilter).map(([value, label]) => ({ value, label }))}
          />
          <Button disabled={!ready} onClick={() => setModal({ fromUser: true })} style={{ marginLeft: 'auto' }}>
            {s.addFromUser}
          </Button>
          {!actionsEl && <ExportButton path="/modules/hr/export/people" />}
        </div>
      {mode === 'table' && (
        <Table
          rowKey="id"
          columns={columns}
          dataSource={rows}
          pagination={{ defaultPageSize: 50, pageSizeOptions: [20, 50, 100], showSizeChanger: true, hideOnSinglePage: rows.length <= 20 }}
        />
      )}
      {mode !== 'table' && rows.length === 0 && <Typography.Text type="secondary">{s.empty}</Typography.Text>}
      {mode === 'cards' && rows.length > 0 && cardGrid}
      {mode === 'groups' && rows.length > 0 && groupList}
      </section>
      {fillOf && fills[fillOf.id] && (
        <FillModal
          person={fillOf}
          fill={fills[fillOf.id]}
          onClose={() => setFillOf(null)}
          onEdit={() => {
            setModal({ person: fillOf })
            setFillOf(null)
          }}
        />
      )}
      {modal && ready && (
        <PersonModal
          key={modal.person?.id ?? 'new'}
          person={modal.person ?? null}
          fromUser={modal.fromUser}
          initialTab={modal.initialTab}
          fields={fields}
          people={people}
          directions={directions}
          users={users}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null)
            await reload()
          }}
        />
      )}
      {archiving && (
        <ArchiveModal
          person={archiving}
          onClose={() => setArchiving(null)}
          onDone={(result) => afterArchive(archiving, result)}
          onNeedReassign={(initialAuto) => {
            setReassign({ person: archiving, initialAuto })
            setArchiving(null)
          }}
        />
      )}
      {reassign && (
        <ReassignModal
          person={reassign.person}
          people={people}
          initialAuto={reassign.initialAuto}
          onClose={() => setReassign(null)}
          onDone={(result) => afterArchive(reassign.person, result)}
        />
      )}
    </>
  )
}

export default function PeopleTab({ actionsEl }) {
  const { data: people, error, reload } = useLoad(`${BASE}/people`)
  const { data: rawDirections, error: dirError } = useLoad(`${BASE}/directions`)
  const directions = useMemo(() => softDirections(rawDirections), [rawDirections])
  const { data: stats, error: statsError, reload: reloadStats } = useLoad('/modules/hr/stats')
  if (error || dirError) return <Alert type="error" showIcon title={strings.loadFailed} description={error ?? dirError} />
  if (!people || !directions) return <Spin />
  const reloadAll = () => {
    reload()
    reloadStats()
  }
  return <PeopleTable people={people} directions={directions} reload={reloadAll} stats={stats} statsError={statsError} actionsEl={actionsEl} />
}
