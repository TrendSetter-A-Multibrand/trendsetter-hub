import { useState } from 'react'
import { Alert, App, Button, Form, Input, Modal, Popconfirm, Select, Space, Spin, Tag, Typography } from 'antd'
import { api } from '../../../core/api/index.js'
import { formatDate, isIsoDate, todayIso } from '../../../core/dates.js'
import strings from '../strings.js'
import { useLoad } from '../lib/useLoad.js'
import { HISTORY_KINDS, HISTORY_TEXT_LIMIT, HISTORY_TITLE_LIMIT, canDeleteHistory } from '../lib/ops.js'
import { DateInput } from './FieldGrid.jsx'

const s = strings.history

function AddModal({ personId, canSeeSensitive, onClose, onDone }) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const kinds = HISTORY_KINDS.filter((k) => k !== 'salary' || canSeeSensitive)

  const submit = async (values) => {
    setSaving(true)
    try {
      await api.post(`/modules/hr/people/${personId}/history`, {
        kind: values.kind,
        effectiveDate: values.effectiveDate,
        title: values.title.trim(),
        oldValue: values.oldValue?.trim() || null,
        newValue: values.newValue?.trim() || null,
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
      <Form form={form} layout="vertical" onFinish={submit} initialValues={{ kind: 'other', effectiveDate: todayIso() }}>
        <Form.Item name="kind" label={s.kind}>
          <Select options={kinds.map((value) => ({ value, label: s.kinds[value] }))} />
        </Form.Item>
        <Form.Item name="effectiveDate" label={s.date} rules={[{ validator: (_, v) => (isIsoDate(v) ? Promise.resolve() : Promise.reject(new Error(s.dateInvalid))) }]}>
          <DateInput />
        </Form.Item>
        <Form.Item name="title" label={s.what} rules={[{ required: true, whitespace: true, max: HISTORY_TITLE_LIMIT, message: s.whatRequired }]}>
          <Input maxLength={HISTORY_TITLE_LIMIT} placeholder={s.whatPlaceholder} />
        </Form.Item>
        <div style={{ display: 'flex', gap: 12 }}>
          <Form.Item name="oldValue" label={s.oldValue} style={{ flex: 1 }}>
            <Input maxLength={HISTORY_TEXT_LIMIT} />
          </Form.Item>
          <Form.Item name="newValue" label={s.newValue} style={{ flex: 1 }}>
            <Input maxLength={HISTORY_TEXT_LIMIT} />
          </Form.Item>
        </div>
        <Form.Item name="comment" label={s.comment}>
          <Input.TextArea rows={2} maxLength={HISTORY_TEXT_LIMIT} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

// Вкладка «История» в модалке сотрудника. canSeeSensitive = responsible: только он видит и создаёт записи об окладе и удаляет любые.
export default function HistoryTab({ person, canSeeSensitive }) {
  const { message } = App.useApp()
  const { data, error, reload } = useLoad(`/modules/hr/people/${person.id}/history`)
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const remove = async (entry) => {
    setBusyId(entry.id)
    try {
      await api.post(`/modules/hr/history/${entry.id}/delete`, {})
      message.success(s.removed)
      reload()
    } catch (e) {
      message.error(e.message)
    }
    setBusyId(null)
  }

  if (error && !data) return <Alert type="error" showIcon title={s.loadFailed} description={error} />
  if (!data) return <Spin />
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <Typography.Text type="secondary">{canSeeSensitive ? s.salaryNote : ''}</Typography.Text>
        <Button type="primary" onClick={() => setAdding(true)}>
          {s.add}
        </Button>
      </div>
      {data.length === 0 && <Typography.Text type="secondary">{s.empty}</Typography.Text>}
      {data.map((h) => (
        <div key={h.id} style={{ borderLeft: '2px solid var(--border-input)', paddingLeft: 12, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <Space wrap size={6}>
              <Typography.Text strong>{formatDate(h.effectiveDate)}</Typography.Text>
              <Tag style={{ marginInlineEnd: 0 }}>{s.kinds[h.kind] ?? h.kind}</Tag>
              {h.auto && <Tag variant="outlined" style={{ marginInlineEnd: 0 }}>{s.auto}</Tag>}
            </Space>
            {canDeleteHistory(h, canSeeSensitive) && (
              <Popconfirm title={s.removeConfirm} okText={s.removeOk} cancelText={s.removeCancel} onConfirm={() => remove(h)}>
                <Button size="small" danger disabled={busyId === h.id}>
                  {s.remove}
                </Button>
              </Popconfirm>
            )}
          </div>
          <div>{h.title}</div>
          {(h.oldValue || h.newValue) && (
            <Typography.Text type="secondary">
              {h.oldValue ?? strings.none} → {h.newValue ?? strings.none}
            </Typography.Text>
          )}
          {h.comment && <div><Typography.Text type="secondary">{h.comment}</Typography.Text></div>}
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {s.by(h.createdBy ?? strings.none, formatDate(h.createdAt.slice(0, 10)))}
            </Typography.Text>
          </div>
        </div>
      ))}
      {adding && (
        <AddModal
          personId={person.id}
          canSeeSensitive={canSeeSensitive}
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
