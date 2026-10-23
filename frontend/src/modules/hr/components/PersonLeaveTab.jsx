import { useState } from 'react'
import { App, Button, Form, Input, InputNumber, Modal, Space, Table, Typography } from 'antd'
import { api } from '../../../core/api/index.js'
import coreStrings from '../../../core/strings.js'
import { formatDate } from '../../../core/dates.js'
import strings from '../strings.js'
import LeaveBalance from '../leave/LeaveBalance.jsx'
import LeaveRequestList, { HrCancelButton } from '../leave/LeaveRequestList.jsx'
import LeaveRequestModal from '../leave/LeaveRequestModal.jsx'

const s = strings.personLeave
const REASON_LIMIT = 500
const DELTA_LIMIT = 365

function AdjustModal({ person, onSaved, onClose }) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  const submit = async ({ deltaDays, reason }) => {
    setSaving(true)
    try {
      await api.post(`/modules/hr/people/${person.id}/leave/adjustments`, { deltaDays, reason: reason.trim() })
      message.success(s.adjustSaved)
      await onSaved()
      onClose()
    } catch (e) {
      message.error(e.message)
      setSaving(false)
    }
  }

  return (
    <Modal open title={s.adjustTitle} okText={strings.person.save} cancelText={coreStrings.cancel} confirmLoading={saving} onCancel={onClose} onOk={() => form.submit()}>
      <Form form={form} layout="vertical" onFinish={submit}>
        <Form.Item
          name="deltaDays"
          label={s.deltaDays}
          extra={s.deltaHint}
          rules={[{ required: true, type: 'number', message: s.deltaRequired }, { validator: (_, v) => (v === 0 ? Promise.reject(new Error(s.deltaRequired)) : Promise.resolve()) }]}
        >
          <InputNumber style={{ width: '100%' }} min={-DELTA_LIMIT} max={DELTA_LIMIT} precision={2} />
        </Form.Item>
        <Form.Item name="reason" label={s.reason} rules={[{ required: true, whitespace: true, max: REASON_LIMIT, message: s.reasonRequired }]}>
          <Input.TextArea rows={3} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

// Вкладка «Отпуск» у HR: баланс, заявки, «Оформить за сотрудника», корректировка остатка. leave — поле leave из GET people/:id/file.
export default function PersonLeaveTab({ person, leave, reload }) {
  const { message } = App.useApp()
  const [requestOpen, setRequestOpen] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)

  const createRequest = async (body) => {
    await api.post(`/modules/hr/people/${person.id}/leave/requests`, { ...body, status: 'approved' })
    await reload()
  }

  const cancel = async (request) => {
    try {
      await api.post(`/modules/hr/leave/requests/${request.id}/cancel`)
      message.success(strings.leaveTab.cancelled)
      await reload()
    } catch (e) {
      message.error(e.message)
    }
  }

  const adjustColumns = [
    { title: s.date, dataIndex: 'createdAt', width: 110, render: (v) => formatDate(v.slice(0, 10)) },
    { title: s.delta, dataIndex: 'deltaDays', width: 80, render: (v) => (v > 0 ? `+${v}` : v) },
    { title: s.reason, dataIndex: 'reason' },
    { title: s.by, dataIndex: 'createdBy', width: 140, render: (v) => v ?? strings.none },
  ]

  return (
    <Space orientation="vertical" size={20} style={{ width: '100%' }}>
      <LeaveBalance balance={leave.balance} policy={leave.policy} />
      <Space wrap>
        <Button type="primary" onClick={() => setRequestOpen(true)}>
          {s.hrRequestOpen}
        </Button>
        <Button onClick={() => setAdjustOpen(true)}>{s.adjustOpen}</Button>
      </Space>
      <div>
        <Typography.Title level={5}>{s.requestsTitle}</Typography.Title>
        <LeaveRequestList requests={leave.requests} renderActions={(r) => <HrCancelButton request={r} onCancel={cancel} />} />
      </div>
      <div>
        <Typography.Title level={5}>{s.adjustmentsTitle}</Typography.Title>
        <Table rowKey="id" size="small" columns={adjustColumns} dataSource={leave.adjustments} pagination={false} locale={{ emptyText: s.adjustmentsEmpty }} />
      </div>
      {requestOpen && (
        <LeaveRequestModal balance={leave.balance} allowPast texts={strings.leave.hrRequest} onSubmit={createRequest} onClose={() => setRequestOpen(false)} />
      )}
      {adjustOpen && <AdjustModal person={person} onSaved={reload} onClose={() => setAdjustOpen(false)} />}
    </Space>
  )
}
