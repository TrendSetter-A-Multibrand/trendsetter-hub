import { useState } from 'react'
import { Alert, App, Button, Checkbox, Form, Input, Modal, Popconfirm, Progress, Select, Space, Spin, Table, Tag, Typography } from 'antd'
import { api } from '../../../core/api/index.js'
import { formatDate, isIsoDate, todayIso } from '../../../core/dates.js'
import strings from '../strings.js'
import { useLoad } from '../lib/useLoad.js'
import { ITEM_NOTE_LIMIT, checklistProgress, isItemOverdue } from '../lib/ops.js'
import { DateInput } from './FieldGrid.jsx'

const s = strings.checklists
const BASE = '/modules/hr'
const RED = '#A22325'

function StartModal({ personId, templates, onClose, onDone }) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const options = templates.filter((t) => t.active).map((t) => ({ value: t.id, label: `${s.kinds[t.kind]}: ${t.title}` }))

  const submit = async (values) => {
    setSaving(true)
    try {
      await api.post(`${BASE}/people/${personId}/checklists`, { templateId: values.templateId, startedAt: values.startedAt })
      message.success(s.started)
      onDone()
    } catch (e) {
      message.error(e.message)
      setSaving(false)
    }
  }

  return (
    <Modal open title={s.startTitle} okText={s.start} cancelText={strings.documents.removeCancel} confirmLoading={saving} okButtonProps={{ disabled: options.length === 0 }} onOk={() => form.submit()} onCancel={onClose} mask={{ closable: false }}>
      {options.length === 0 && <Alert type="warning" showIcon title={s.noTemplates} style={{ marginBottom: 12 }} />}
      <Form form={form} layout="vertical" onFinish={submit} initialValues={{ startedAt: todayIso() }}>
        <Form.Item name="templateId" label={s.template} rules={[{ required: true, message: s.templateRequired }]}>
          <Select options={options} placeholder={s.templatePlaceholder} />
        </Form.Item>
        <Form.Item
          name="startedAt"
          label={s.startedAt}
          extra={s.startedHint}
          rules={[{ validator: (_, v) => (isIsoDate(v) ? Promise.resolve() : Promise.reject(new Error(s.dateInvalid))) }]}
        >
          <DateInput />
        </Form.Item>
      </Form>
    </Modal>
  )
}

function ItemModal({ item, users, onClose, onDone }) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  const submit = async (values) => {
    setSaving(true)
    try {
      await api.patch(`${BASE}/checklist-items/${item.id}`, {
        assigneeUserId: values.assigneeUserId ?? null,
        dueDate: values.dueDate ?? null,
        note: values.note?.trim() || null,
      })
      message.success(s.itemSaved)
      onDone()
    } catch (e) {
      message.error(e.message)
      setSaving(false)
    }
  }

  return (
    <Modal open title={s.editTitle} okText={strings.person.save} cancelText={strings.documents.removeCancel} confirmLoading={saving} onOk={() => form.submit()} onCancel={onClose} mask={{ closable: false }}>
      <Typography.Paragraph strong>{item.title}</Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={submit} initialValues={{ assigneeUserId: item.assignee?.id ?? null, dueDate: item.dueDate, note: item.note ?? '' }}>
        <Form.Item name="assigneeUserId" label={s.assignee}>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder={s.assigneePlaceholder}
            options={users.map((u) => ({ value: u.id, label: u.fullName }))}
          />
        </Form.Item>
        <Form.Item
          name="dueDate"
          label={s.due}
          rules={[{ validator: (_, v) => (v === null || v === undefined || isIsoDate(v) ? Promise.resolve() : Promise.reject(new Error(s.dateInvalid))) }]}
        >
          <DateInput />
        </Form.Item>
        <Form.Item name="note" label={s.note} rules={[{ max: ITEM_NOTE_LIMIT, message: s.noteTooLong }]}>
          <Input.TextArea rows={3} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

function ChecklistCard({ checklist, users, today, onChanged }) {
  const { message } = App.useApp()
  const [busyId, setBusyId] = useState(null)
  const [editing, setEditing] = useState(null)
  const active = checklist.status === 'active'
  const progress = checklistProgress(checklist.items)
  const status = s.statuses[checklist.status]

  const toggle = async (item, done) => {
    setBusyId(item.id)
    try {
      await api.patch(`${BASE}/checklist-items/${item.id}`, { done })
      await onChanged()
    } catch (e) {
      message.error(e.message)
    }
    setBusyId(null)
  }

  const finish = async (action, okText) => {
    try {
      await api.post(`${BASE}/checklists/${checklist.id}/${action}`, {})
      message.success(okText)
      await onChanged()
    } catch (e) {
      message.error(e.message)
    }
  }

  const columns = [
    {
      title: '',
      dataIndex: 'done',
      width: 40,
      render: (done, item) => <Checkbox checked={done} disabled={!active || busyId === item.id} onChange={(e) => toggle(item, e.target.checked)} />,
    },
    {
      title: s.item,
      render: (_, item) => (
        <div>
          <span style={item.done ? { textDecoration: 'line-through', color: '#8A8381' } : undefined}>{item.title}</span>
          {item.note && <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{item.note}</Typography.Text></div>}
          {item.done && item.doneAt && (
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {s.doneAt(formatDate(item.doneAt.slice(0, 10)), item.doneBy)}
              </Typography.Text>
            </div>
          )}
        </div>
      ),
    },
    { title: s.assignee, width: 150, render: (_, item) => item.assignee?.name ?? <Typography.Text type="secondary">{s.noAssignee}</Typography.Text> },
    {
      title: s.due,
      width: 130,
      render: (_, item) =>
        !item.dueDate ? (
          strings.none
        ) : isItemOverdue(item, today) ? (
          <Space size={4} wrap>
            <Typography.Text style={{ color: RED }}>{formatDate(item.dueDate)}</Typography.Text>
            <Tag color="error" style={{ marginInlineEnd: 0 }}>{s.overdue}</Tag>
          </Space>
        ) : (
          formatDate(item.dueDate)
        ),
    },
    {
      title: '',
      width: 90,
      render: (_, item) => (
        <Button size="small" disabled={!active} onClick={() => setEditing(item)}>
          {s.editItem}
        </Button>
      ),
    },
  ]

  return (
    <section style={{ border: '1px solid #e5e5e5', borderRadius: 8, padding: 12, marginBottom: 16, opacity: active ? 1 : 0.85 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <Space wrap size={6}>
          <Typography.Text strong>{checklist.title}</Typography.Text>
          <Tag style={{ marginInlineEnd: 0 }}>{s.kinds[checklist.kind]}</Tag>
          <Tag color={status.color} style={{ marginInlineEnd: 0 }}>{status.label}</Tag>
          <Typography.Text type="secondary">{s.startedOn(formatDate(checklist.startedAt))}</Typography.Text>
        </Space>
        {active && (
          <Space size="small">
            <Popconfirm title={s.closeConfirm} okText={s.closeOk} cancelText={s.no} onConfirm={() => finish('close', s.closed)}>
              <Button size="small">{s.close}</Button>
            </Popconfirm>
            <Popconfirm title={s.cancelConfirm} okText={s.cancelOk} okButtonProps={{ danger: true }} cancelText={s.no} onConfirm={() => finish('cancel', s.cancelled)}>
              <Button size="small" danger>
                {s.cancel}
              </Button>
            </Popconfirm>
          </Space>
        )}
      </div>
      <Progress percent={progress.percent} size="small" format={() => s.progress(progress.done, progress.total)} style={{ marginBottom: 8 }} />
      <Table size="small" rowKey="id" columns={columns} dataSource={checklist.items} pagination={false} />
      {editing && (
        <ItemModal
          item={editing}
          users={users}
          onClose={() => setEditing(null)}
          onDone={async () => {
            setEditing(null)
            await onChanged()
          }}
        />
      )}
    </section>
  )
}

// Вкладка «Чек-листы» в модалке сотрудника: запуск из шаблона, пункты с отметкой, исполнителем, сроком и заметкой.
export default function PersonChecklistsTab({ person, users }) {
  const { data, error, reload } = useLoad(`${BASE}/people/${person.id}/checklists`)
  const { data: templates } = useLoad(`${BASE}/checklist-templates`)
  const [starting, setStarting] = useState(false)
  const today = todayIso()

  if (error && !data) return <Alert type="error" showIcon title={s.loadFailed} description={error} />
  if (!data) return <Spin />
  return (
    <div>
      <div style={{ textAlign: 'right', marginBottom: 12 }}>
        <Button type="primary" disabled={!templates} onClick={() => setStarting(true)}>
          {s.start}
        </Button>
      </div>
      {data.length === 0 && <Typography.Text type="secondary">{s.empty}</Typography.Text>}
      {data.map((c) => (
        <ChecklistCard key={c.id} checklist={c} users={users} today={today} onChanged={reload} />
      ))}
      {starting && templates && (
        <StartModal
          personId={person.id}
          templates={templates}
          onClose={() => setStarting(false)}
          onDone={() => {
            setStarting(false)
            reload()
          }}
        />
      )}
    </div>
  )
}
