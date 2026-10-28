import { useState } from 'react'
import { Alert, App, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd'
import { api } from '../../../core/api/index.js'
import { formatDate, isIsoDate, todayIso } from '../../../core/dates.js'
import strings from '../strings.js'
import { useLoad } from '../lib/useLoad.js'
import { EQUIPMENT_KINDS, EQUIPMENT_NAME_LIMIT, EQUIPMENT_TEXT_LIMIT, isEquipmentOverdue } from '../lib/ops.js'
import { DateInput } from './FieldGrid.jsx'

const s = strings.equipment
const dateRule = (message, optional) => ({
  validator: (_, v) => (optional && (v === null || v === undefined) ? Promise.resolve() : isIsoDate(v) ? Promise.resolve() : Promise.reject(new Error(message))),
})

function AddModal({ personId, onClose, onDone }) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  const submit = async (values) => {
    setSaving(true)
    try {
      await api.post(`/modules/hr/people/${personId}/equipment`, {
        kind: values.kind,
        name: values.name.trim(),
        serial: values.serial?.trim() || null,
        issuedAt: values.issuedAt,
        returnDue: values.returnDue ?? null,
        comment: values.comment?.trim() || null,
      })
      message.success(s.added)
      onDone()
    } catch (e) {
      message.error(e.message)
      setSaving(false)
    }
  }

  return (
    <Modal open title={s.addTitle} okText={strings.person.save} cancelText={s.removeCancel} confirmLoading={saving} onOk={() => form.submit()} onCancel={onClose} mask={{ closable: false }}>
      <Form form={form} layout="vertical" onFinish={submit} initialValues={{ kind: 'laptop', issuedAt: todayIso(), returnDue: null }}>
        <Form.Item name="kind" label={s.kind}>
          <Select options={EQUIPMENT_KINDS.map((value) => ({ value, label: s.kinds[value] }))} />
        </Form.Item>
        <Form.Item name="name" label={s.name} rules={[{ required: true, whitespace: true, max: EQUIPMENT_NAME_LIMIT, message: s.nameRequired }]}>
          <Input maxLength={EQUIPMENT_NAME_LIMIT} />
        </Form.Item>
        <Form.Item name="serial" label={s.serial}>
          <Input maxLength={EQUIPMENT_NAME_LIMIT} />
        </Form.Item>
        <div style={{ display: 'flex', gap: 12 }}>
          <Form.Item name="issuedAt" label={s.issuedAt} style={{ flex: 1 }} rules={[dateRule(s.issuedRequired, false)]}>
            <DateInput />
          </Form.Item>
          <Form.Item name="returnDue" label={s.returnDue} style={{ flex: 1 }} rules={[dateRule(s.dateInvalid, true)]}>
            <DateInput />
          </Form.Item>
        </div>
        <Form.Item name="comment" label={s.comment}>
          <Input.TextArea rows={2} maxLength={EQUIPMENT_TEXT_LIMIT} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

// Вкладка «Оборудование» в модалке сотрудника: выдать, отметить возврат, удалить. Просроченный возврат подсвечен.
export default function EquipmentTab({ person }) {
  const { message } = App.useApp()
  const { data, error, reload } = useLoad(`/modules/hr/people/${person.id}/equipment`)
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const today = todayIso()

  const run = async (item, request, okText) => {
    setBusyId(item.id)
    try {
      await request()
      message.success(okText)
      reload()
    } catch (e) {
      message.error(e.message)
    }
    setBusyId(null)
  }

  const columns = [
    { title: s.kind, dataIndex: 'kind', render: (k) => <Tag>{s.kinds[k] ?? k}</Tag> },
    { title: s.name, dataIndex: 'name' },
    { title: s.serial, dataIndex: 'serial', render: (v) => v ?? strings.none },
    { title: s.issuedAt, dataIndex: 'issuedAt', render: formatDate },
    {
      title: s.returnDue,
      dataIndex: 'returnDue',
      render: (v, item) =>
        v ? (
          isEquipmentOverdue(item, today) ? (
            <Space size={4} wrap>
              <Typography.Text style={{ color: 'var(--red)' }}>{formatDate(v)}</Typography.Text>
              <Tag color="error" style={{ marginInlineEnd: 0 }}>{s.overdue}</Tag>
            </Space>
          ) : (
            formatDate(v)
          )
        ) : (
          strings.none
        ),
    },
    { title: s.returnedAt, dataIndex: 'returnedAt', render: (v) => (v ? formatDate(v) : strings.none) },
    {
      title: '',
      key: 'actions',
      fixed: 'right',
      render: (_, item) => (
        <Space size="small">
          {!item.returnedAt && (
            <Popconfirm
              title={s.returnConfirm}
              okText={s.returnOk}
              cancelText={s.returnCancel}
              onConfirm={() => run(item, () => api.patch(`/modules/hr/equipment/${item.id}`, { returnedAt: today }), s.returned)}
            >
              <Button size="small" disabled={busyId === item.id}>
                {s.markReturned}
              </Button>
            </Popconfirm>
          )}
          <Popconfirm
            title={s.removeConfirm}
            okText={s.removeOk}
            cancelText={s.removeCancel}
            onConfirm={() => run(item, () => api.post(`/modules/hr/equipment/${item.id}/delete`, {}), s.removed)}
          >
            <Button size="small" danger disabled={busyId === item.id}>
              {s.remove}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  if (error && !data) return <Alert type="error" showIcon title={s.loadFailed} description={error} />
  return (
    <div>
      <div style={{ textAlign: 'right', marginBottom: 12 }}>
        <Button type="primary" disabled={!data} onClick={() => setAdding(true)}>
          {s.add}
        </Button>
      </div>
      <Table
        size="small"
        rowKey="id"
        loading={!data}
        dataSource={data ?? []}
        columns={columns}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: s.empty }}
        onRow={(item) => ({ style: isEquipmentOverdue(item, today) ? { background: 'var(--tint-red)' } : undefined })}
      />
      {adding && (
        <AddModal
          personId={person.id}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false)
            reload()
          }}
        />
      )}
    </div>
  )
}
