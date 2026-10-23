import { useState } from 'react'
import { Alert, App, Button, Input, InputNumber, Modal, Progress, Select, Space, Spin, Switch, Table, Tag, Typography } from 'antd'
import { api } from '../../../core/api/index.js'
import { formatDate } from '../../../core/dates.js'
import strings from '../strings.js'
import { useLoad } from '../lib/useLoad.js'
import PersonModal from './PersonModal.jsx'
import { CHECKLIST_KINDS, DAYS_OFFSET_MAX, ITEM_TITLE_LIMIT, TEMPLATE_TITLE_LIMIT, copyTemplateItems, itemsEdited } from '../lib/ops.js'

const s = strings.templates
const BASE = '/modules/hr/checklist-templates'
const EMPTY_BASE = 'empty'
let lastKey = 0
const row = (title = '', daysOffset = null) => ({ key: (lastKey += 1), title, daysOffset })

// Создание и правка шаблона. Пункты редактируются списком и уходят на сервер целиком.
// templates — все шаблоны: из них выбирается «основа» нового шаблона
function TemplateModal({ template, templates, onClose, onDone }) {
  const { message, modal } = App.useApp()
  const isEdit = Boolean(template)
  const [kind, setKind] = useState(template?.kind ?? 'onboarding')
  const [title, setTitle] = useState(template?.title ?? '')
  const [initialBase] = useState(null) // новый шаблон открывается пустым; образец — по желанию через «Взять за основу»
  const [baseId, setBaseId] = useState(initialBase?.id ?? null)
  const [seed, setSeed] = useState(() => (isEdit ? [] : copyTemplateItems(initialBase))) // чем пункты были заполнены последний раз
  const [items, setItems] = useState(() => (template ? template.items : seed).map((i) => row(i.title, i.daysOffset)))
  const [saving, setSaving] = useState(false)

  // Смена вида/основы заново заполняет пункты; если пользователь уже правил пункты — сначала спрашиваем
  const applyBase = (nextKind, nextBaseId) => {
    const apply = () => {
      const next = copyTemplateItems(templates.find((t) => t.id === nextBaseId))
      setSeed(next)
      setKind(nextKind)
      setBaseId(nextBaseId)
      setItems(next.map((i) => row(i.title, i.daysOffset)))
    }
    if (!itemsEdited(items, seed)) return apply()
    modal.confirm({ title: s.baseConfirmTitle, content: s.baseConfirmText, okText: s.baseConfirmOk, cancelText: strings.documents.removeCancel, onOk: apply })
  }
  const changeKind = (nextKind) => applyBase(nextKind, null)
  const baseOptions = [
    { value: EMPTY_BASE, label: s.baseEmpty },
    ...templates.filter((t) => t.kind === kind).map((t) => ({ value: t.id, label: t.title })),
  ]

  const setItem = (key, patch) => setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...patch } : i)))
  const move = (index, delta) =>
    setItems((cur) => {
      const next = [...cur]
      ;[next[index], next[index + delta]] = [next[index + delta], next[index]]
      return next
    })

  const submit = async () => {
    const cleanTitle = title.trim()
    if (!cleanTitle || cleanTitle.length > TEMPLATE_TITLE_LIMIT) return message.error(s.nameRequired)
    if (items.length === 0) return message.error(s.itemsRequired)
    if (items.some((i) => !i.title.trim() || i.title.trim().length > ITEM_TITLE_LIMIT)) return message.error(s.itemRequired)
    const body = { title: cleanTitle, items: items.map((i) => ({ title: i.title.trim(), daysOffset: i.daysOffset ?? null })) }
    setSaving(true)
    try {
      if (isEdit) await api.patch(`${BASE}/${template.id}`, body)
      else await api.post(BASE, { ...body, kind })
      message.success(isEdit ? s.saved : s.created)
      onDone()
    } catch (e) {
      message.error(e.message)
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      width={680}
      title={isEdit ? s.editTitle(template.title) : s.addTitle}
      okText={strings.person.save}
      cancelText={strings.documents.removeCancel}
      confirmLoading={saving}
      onOk={submit}
      onCancel={onClose}
      mask={{ closable: false }}
      styles={{ body: { maxHeight: '65vh', overflowY: 'auto', paddingRight: 8 } }}
    >
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ width: 180 }}>
            <div style={{ marginBottom: 4 }}>
              <Typography.Text strong>{s.kind}</Typography.Text>
            </div>
            <Select
              style={{ width: '100%' }}
              disabled={isEdit}
              value={kind}
              onChange={changeKind}
              options={CHECKLIST_KINDS.map((value) => ({ value, label: strings.checklists.kinds[value] }))}
            />
          </div>
          {!isEdit && (
            <div style={{ width: 220 }}>
              <div style={{ marginBottom: 4 }}>
                <Typography.Text strong>{s.base}</Typography.Text>
              </div>
              <Select style={{ width: '100%' }} aria-label={s.base} value={baseId ?? EMPTY_BASE} onChange={(v) => applyBase(kind, v === EMPTY_BASE ? null : v)} options={baseOptions} />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ marginBottom: 4 }}>
              <Typography.Text strong>{s.name}</Typography.Text>
            </div>
            <Input value={title} maxLength={TEMPLATE_TITLE_LIMIT} onChange={(e) => setTitle(e.target.value)} />
          </div>
        </div>
        <Typography.Text strong>{s.itemsTitle}</Typography.Text>
        {items.map((item, i) => (
          <div key={item.key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Typography.Text type="secondary" style={{ width: 22 }}>
              {i + 1}.
            </Typography.Text>
            <Input
              aria-label={s.itemTitle}
              placeholder={s.itemTitle}
              value={item.title}
              maxLength={ITEM_TITLE_LIMIT}
              onChange={(e) => setItem(item.key, { title: e.target.value })}
            />
            <InputNumber
              aria-label={s.daysOffset}
              placeholder={s.daysOffset}
              style={{ width: 150 }}
              min={0}
              max={DAYS_OFFSET_MAX}
              precision={0}
              value={item.daysOffset}
              onChange={(v) => setItem(item.key, { daysOffset: v ?? null })}
            />
            <Button size="small" disabled={i === 0} aria-label={s.up} title={s.up} onClick={() => move(i, -1)}>
              ↑
            </Button>
            <Button size="small" disabled={i === items.length - 1} aria-label={s.down} title={s.down} onClick={() => move(i, 1)}>
              ↓
            </Button>
            <Button size="small" danger aria-label={s.removeItem} title={s.removeItem} onClick={() => setItems((cur) => cur.filter((x) => x.key !== item.key))}>
              ×
            </Button>
          </div>
        ))}
        <Button onClick={() => setItems((cur) => [...cur, row()])}>{s.addItem}</Button>
      </Space>
    </Modal>
  )
}

// Обзор запущенных чек-листов (GET /checklists): строка открывает модалку сотрудника на вкладке «Чек-листы».
function Overview() {
  const [status, setStatus] = useState('active')
  const { data, error, reload } = useLoad(`/modules/hr/checklists?status=${status}`)
  const { data: people, reload: reloadPeople } = useLoad('/modules/team/hr/people')
  const { data: directions } = useLoad('/modules/team/hr/directions')
  const { data: fields } = useLoad('/modules/team/hr/fields')
  const { data: users } = useLoad('/modules/team/hr/users')
  const [openId, setOpenId] = useState(null)
  const person = people?.find((p) => p.id === openId)
  const statuses = strings.checklists.statuses

  const columns = [
    { title: s.overviewPerson, dataIndex: 'personName' },
    { title: s.overviewKind, dataIndex: 'kind', width: 120, render: (k) => <Tag>{strings.checklists.kinds[k]}</Tag> },
    { title: s.overviewName, dataIndex: 'title' },
    {
      title: s.overviewProgress,
      width: 200,
      render: (_, c) => (
        <Progress size="small" percent={c.progress.total === 0 ? 0 : Math.round((c.progress.done / c.progress.total) * 100)} format={() => strings.checklists.progress(c.progress.done, c.progress.total)} />
      ),
    },
    { title: s.overviewOverdue, width: 130, render: (_, c) => (c.overdue > 0 ? <Tag color="error">{s.overviewOverdueTag(c.overdue)}</Tag> : strings.none) },
    { title: s.overviewStarted, dataIndex: 'startedAt', width: 110, render: formatDate },
  ]

  return (
    <div>
      <Space wrap style={{ marginBottom: 8 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {s.overviewTitle}
        </Typography.Title>
        <Select
          aria-label={s.overviewStatus}
          style={{ width: 180 }}
          value={status}
          onChange={setStatus}
          options={[{ value: 'all', label: s.overviewAll }, ...Object.entries(statuses).map(([value, st]) => ({ value, label: st.label }))]}
        />
      </Space>
      <div style={{ marginBottom: 8 }}>
        <Typography.Text type="secondary">{s.overviewOpen}</Typography.Text>
      </div>
      {error && !data ? (
        <Alert type="error" showIcon title={s.overviewFailed} description={error} />
      ) : (
        <Table
          size="middle"
          rowKey="id"
          loading={!data}
          columns={columns}
          dataSource={data ?? []}
          pagination={false}
          locale={{ emptyText: s.overviewEmpty }}
          onRow={(c) => ({ onClick: () => setOpenId(c.personId), style: { cursor: 'pointer' } })}
        />
      )}
      {person && fields && directions && users && (
        <PersonModal
          key={person.id}
          person={person}
          initialTab="checklists"
          fields={fields}
          people={people}
          directions={directions}
          users={users}
          onClose={() => {
            setOpenId(null)
            reload()
            reloadPeople()
          }}
          onSaved={async () => {
            setOpenId(null)
            reload()
            reloadPeople()
          }}
        />
      )}
    </div>
  )
}

// Вкладка модуля «Чек-листы»: обзор запущенных чек-листов и шаблоны онбординга/оффбординга.
export default function ChecklistTemplatesTab() {
  const { message } = App.useApp()
  const { data, error, reload } = useLoad(BASE)
  const [modal, setModal] = useState(null) // { template? }
  const [busyId, setBusyId] = useState(null)

  const toggleActive = async (t, active) => {
    setBusyId(t.id)
    try {
      await api.patch(`${BASE}/${t.id}`, { active })
      message.success(active ? s.activated : s.deactivated)
      reload()
    } catch (e) {
      message.error(e.message)
    }
    setBusyId(null)
  }

  const columns = [
    { title: s.name, dataIndex: 'title' },
    { title: s.kind, dataIndex: 'kind', width: 140, render: (k) => <Tag>{strings.checklists.kinds[k]}</Tag> },
    { title: s.items, width: 100, render: (_, t) => t.items.length },
    {
      title: s.active,
      width: 100,
      render: (_, t) => <Switch size="small" checked={t.active} disabled={busyId === t.id} onChange={(v) => toggleActive(t, v)} />,
    },
    {
      title: strings.actions,
      width: 120,
      render: (_, t) => (
        <Button size="small" onClick={() => setModal({ template: t })}>
          {s.edit}
        </Button>
      ),
    },
  ]

  if (error && !data) return <Alert type="error" showIcon title={s.loadFailed} description={error} />
  if (!data) return <Spin />
  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <Typography.Text type="secondary">{s.note}</Typography.Text>
        <Button type="primary" onClick={() => setModal({})}>
          {s.add}
        </Button>
      </div>
      <Table size="middle" rowKey="id" columns={columns} dataSource={data} pagination={false} locale={{ emptyText: s.empty }} />
      <Overview />
      {modal && (
        <TemplateModal
          key={modal.template?.id ?? 'new'}
          template={modal.template ?? null}
          templates={data}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null)
            reload()
          }}
        />
      )}
    </Space>
  )
}
