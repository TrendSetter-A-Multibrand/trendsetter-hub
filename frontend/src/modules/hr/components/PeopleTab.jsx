import { useMemo, useState } from 'react'
import { Alert, App, Avatar, Button, Collapse, Dropdown, Input, Modal,Segmented, Select, Space, Spin, Switch, Table, Tag, Typography } from 'antd'
import { api } from '../../../core/api/index.js'
import coreStrings from '../../../core/strings.js'
import strings from '../strings.js'
import { useLoad } from '../lib/useLoad.js'
import { managerOptions, personName } from '../lib/options.js'
import { completeness, levelOf } from '../lib/completeness.js'
import PersonModal from './PersonModal.jsx'

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

function DirTag({ d }) {
  return d ? (
    <Tag variant="solid" style={{ background: d.color, color: d.avatarInk, marginInlineEnd: 0 }}>
      {d.shortName}
    </Tag>
  ) : (
    strings.none
  )
}

// Процент заполненности; весь тег — кнопка. Уволенные — без цветового акцента.
function FillTag({ fill, person, onOpen }) {
  if (!fill) return strings.none
  const color = person.isArchived ? 'default' : levelOf(fill.percent)
  return (
    <Tag
      color={color}
      variant="outlined"
      style={{ cursor: 'pointer', marginInlineEnd: 0 }}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(person)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(person)}
    >
      {fill.percent}%
    </Tag>
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

function ReassignModal({ person, people, onClose, onDone }) {
  const { message } = App.useApp()
  const [target, setTarget] = useState(null)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (target === null) return message.error(s.reassignRequired)
    setSaving(true)
    try {
      await api.patch(`${BASE}/people/${person.id}`, { isArchived: true, reassignTo: target })
      message.success(s.archived)
      await onDone()
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
        style={{ width: '100%', marginTop: 4 }}
        value={target}
        onChange={setTarget}
        options={managerOptions(people, [person.id])}
      />
    </Modal>
  )
}

function PeopleTable({ people, directions, reload }) {
  const { message, modal: confirmModal } = App.useApp()
  const { data: fields } = useLoad(`${BASE}/fields`)
  const { data: users } = useLoad(`${BASE}/users`)
  const [query, setQuery] = useState('')
  const [dirFilter, setDirFilter] = useState(null)
  const [view, setView] = useState('active')
  const [mode, setModeState] = useState(loadMode)
  const [shown, setShown] = useState(CARDS_STEP)
  const [modal, setModal] = useState(null) // { person?, fromUser? }
  const [reassign, setReassign] = useState(null)
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
      if (e.status === 409 && body.isArchived && person.directReports > 0) setReassign(person)
      else message.error(e.message)
    }
  }

  const mapSwitch = (p) => (
    <Switch
      size="small"
      checked={p.showInMap}
      disabled={p.isArchived}
      onChange={(v) => patch(p, { showInMap: v }, v ? s.shownInMap : s.hiddenInMap)}
    />
  )

  const confirmArchive = (p) =>
    confirmModal.confirm({
      title: s.archiveConfirm(p.name),
      okText: s.archive,
      okButtonProps: { danger: true },
      cancelText: coreStrings.cancel,
      onOk: () => patch(p, { isArchived: true }, s.archived),
    })

  // опасное действие спрятано в меню «⋯», чтобы не нажать случайно
  const actionButtons = (p, short) => (
    <Space size={4} wrap>
      {p.isArchived && !short && <Tag>{s.archivedTag}</Tag>}
      <Button size="small" onClick={() => setModal({ person: p })}>
        {s.edit}
      </Button>
      <Dropdown
        trigger={['click']}
        menu={{
          items: p.isArchived
            ? [{ key: 'restore', label: s.restore, onClick: () => patch(p, { isArchived: false }, s.restored) }]
            : [{ key: 'archive', label: p.isCeo ? s.ceoLocked : s.archive, danger: true, disabled: p.isCeo, onClick: () => confirmArchive(p) }],
        }}
      >
        <Button size="small" aria-label={s.moreActions} title={s.moreActions}>
          ⋯
        </Button>
      </Dropdown>
    </Space>
  )

  const fillTag = (p) => <FillTag fill={fills[p.id]} person={p} onOpen={setFillOf} />
  const avatar = (p, size) => (
    <Avatar size={size} src={p.thumb}>
      {p.name.charAt(0)}
    </Avatar>
  )

  const columns = [
    {
      title: s.name,
      render: (_, p) => (
        <Space>
          {avatar(p)}
          <div>
            <div>{p.name}</div>
            <Typography.Text type="secondary">{p.title}</Typography.Text>
          </div>
        </Space>
      ),
    },
    { title: s.direction, render: (_, p) => <DirTag d={dirById[p.directionId]} /> },
    { title: s.manager, render: (_, p) => personName(people, p.managerId) ?? strings.none },
    {
      title: s.teamTag,
      render: (_, p) => [p.team, p.tag].filter(Boolean).join(' / ') || strings.none,
    },
    { title: s.filled, align: 'center', render: (_, p) => fillTag(p) },
    { title: s.showInMap, align: 'center', render: (_, p) => mapSwitch(p) },
    { title: strings.actions, render: (_, p) => actionButtons(p) },
  ]

  const cardGrid = (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {rows.slice(0, shown).map((p) => (
          <div
            key={p.id}
            style={{ border: '1px solid #e5e5e5', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, opacity: p.isArchived ? 0.75 : 1 }}
          >
            <Space align="start">
              {avatar(p, 48)}
              <div>
                <div style={{ fontWeight: 600 }}>{p.name}</div>
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
      <Space wrap style={{ marginBottom: 16 }}>
        <Segmented value={mode} onChange={setMode} options={MODES.map((value) => ({ value, label: s.modes[value] }))} />
        <Input.Search
          allowClear
          placeholder={s.search}
          style={{ width: 280 }}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setShown(CARDS_STEP)
          }}
        />
        <Select
          allowClear
          placeholder={s.directionFilter}
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
          value={view}
          onChange={(v) => {
            setView(v)
            setShown(CARDS_STEP)
          }}
          options={Object.entries(s.viewFilter).map(([value, label]) => ({ value, label }))}
        />
        <Button type="primary" disabled={!ready} onClick={() => setModal({})}>
          {s.add}
        </Button>
        <Button disabled={!ready} onClick={() => setModal({ fromUser: true })}>
          {s.addFromUser}
        </Button>
      </Space>
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
      {reassign && (
        <ReassignModal
          person={reassign}
          people={people}
          onClose={() => setReassign(null)}
          onDone={async () => {
            setReassign(null)
            await reload()
          }}
        />
      )}
    </>
  )
}

export default function PeopleTab() {
  const { data: people, error, reload } = useLoad(`${BASE}/people`)
  const { data: directions, error: dirError } = useLoad(`${BASE}/directions`)
  if (error || dirError) return <Alert type="error" showIcon title={strings.loadFailed} description={error ?? dirError} />
  if (!people || !directions) return <Spin />
  return <PeopleTable people={people} directions={directions} reload={reload} />
}
