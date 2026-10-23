import { useMemo, useState } from 'react'
import { Alert, App, Avatar, Button, Input, Modal, Popconfirm, Select, Space, Spin, Switch, Table, Tag, Typography } from 'antd'
import { api } from '../../../core/api/index.js'
import coreStrings from '../../../core/strings.js'
import strings from '../strings.js'
import { useLoad } from '../lib/useLoad.js'
import { managerOptions, personName } from '../lib/options.js'
import PersonModal from './PersonModal.jsx'

const s = strings.people
const BASE = '/modules/team/hr'

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
  const { message } = App.useApp()
  const { data: fields } = useLoad(`${BASE}/fields`)
  const { data: users } = useLoad(`${BASE}/users`)
  const [query, setQuery] = useState('')
  const [dirFilter, setDirFilter] = useState(null)
  const [view, setView] = useState('active')
  const [modal, setModal] = useState(null) // { person?, fromUser? }
  const [reassign, setReassign] = useState(null)

  const dirById = useMemo(() => Object.fromEntries(directions.map((d) => [d.id, d])), [directions])

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

  const columns = [
    {
      title: s.name,
      render: (_, p) => (
        <Space>
          <Avatar src={p.thumb}>{p.name.charAt(0)}</Avatar>
          <div>
            <div>{p.name}</div>
            <Typography.Text type="secondary">{p.title}</Typography.Text>
          </div>
        </Space>
      ),
    },
    {
      title: s.direction,
      render: (_, p) => {
        const d = dirById[p.directionId]
        return d ? <Tag variant="solid" style={{ background: d.color, color: d.avatarInk }}>{d.shortName}</Tag> : strings.none
      },
    },
    { title: s.manager, render: (_, p) => personName(people, p.managerId) ?? strings.none },
    {
      title: s.teamTag,
      render: (_, p) => [p.team, p.tag].filter(Boolean).join(' / ') || strings.none,
    },
    {
      title: s.showInMap,
      align: 'center',
      render: (_, p) => (
        <Switch
          size="small"
          checked={p.showInMap}
          disabled={p.isArchived}
          onChange={(v) => patch(p, { showInMap: v }, v ? s.shownInMap : s.hiddenInMap)}
        />
      ),
    },
    {
      title: strings.actions,
      render: (_, p) => (
        <Space>
          {p.isArchived && <Tag>{s.archivedTag}</Tag>}
          <Button size="small" onClick={() => setModal({ person: p })}>
            {s.edit}
          </Button>
          {p.isArchived ? (
            <Button size="small" onClick={() => patch(p, { isArchived: false }, s.restored)}>
              {s.restore}
            </Button>
          ) : (
            <Popconfirm
              title={s.archiveConfirm(p.name)}
              okText={s.archive}
              cancelText={coreStrings.cancel}
              disabled={p.isCeo}
              onConfirm={() => patch(p, { isArchived: true }, s.archived)}
            >
              <Button size="small" danger disabled={p.isCeo} title={p.isCeo ? s.ceoLocked : undefined}>
                {s.archive}
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  const ready = fields && users
  return (
    <>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search allowClear placeholder={s.search} style={{ width: 280 }} value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select
          allowClear
          placeholder={s.directionFilter}
          style={{ width: 200 }}
          value={dirFilter}
          onChange={(v) => setDirFilter(v ?? null)}
          options={directions.map((d) => ({ value: d.id, label: d.shortName }))}
        />
        <Select
          style={{ width: 200 }}
          value={view}
          onChange={setView}
          options={Object.entries(s.viewFilter).map(([value, label]) => ({ value, label }))}
        />
        <Button type="primary" disabled={!ready} onClick={() => setModal({})}>
          {s.add}
        </Button>
        <Button disabled={!ready} onClick={() => setModal({ fromUser: true })}>
          {s.addFromUser}
        </Button>
      </Space>
      <Table rowKey="id" columns={columns} dataSource={rows} pagination={{ pageSize: 20, hideOnSinglePage: true }} />
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
