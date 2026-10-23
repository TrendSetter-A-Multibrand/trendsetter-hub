import { useState } from 'react'
import { Button, Form, Input, Modal, Popconfirm, Space, Table, Typography } from 'antd'
import coreStrings from '../../../core/strings.js'
import strings from '../strings.js'
import { StatusTag } from './LeaveRequestList.jsx'
import { periodText } from './helpers.js'

const s = strings.leave
const COMMENT_LIMIT = 500

function RejectModal({ request, onDecide, onClose }) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const submit = async ({ comment }) => {
    setSaving(true)
    const ok = await onDecide(request, false, comment.trim())
    if (ok) onClose()
    else setSaving(false)
  }
  return (
    <Modal open title={`${s.approvals.rejectTitle}: ${request.personName}`} okText={s.approvals.reject} okButtonProps={{ danger: true }} cancelText={coreStrings.cancel} confirmLoading={saving} onCancel={onClose} onOk={() => form.submit()}>
      <Form form={form} layout="vertical" onFinish={submit}>
        <Form.Item
          name="comment"
          label={s.approvals.rejectComment}
          rules={[{ required: true, whitespace: true, max: COMMENT_LIMIT, message: s.approvals.rejectCommentRequired }]}
        >
          <Input.TextArea rows={3} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

// Кнопки «Согласовать» / «Отклонить» для одной заявки (отклонение — с комментарием). onDecide — как в ApprovalsList.
export function DecisionButtons({ request, onDecide }) {
  const [rejecting, setRejecting] = useState(false)
  return (
    <Space size={4}>
      <Popconfirm title={s.approvals.approveConfirm} okText={s.approvals.approve} cancelText={s.list.cancelNo} onConfirm={() => onDecide(request, true)}>
        <Button size="small" type="primary">
          {s.approvals.approve}
        </Button>
      </Popconfirm>
      <Button size="small" danger onClick={() => setRejecting(true)}>
        {s.approvals.reject}
      </Button>
      {rejecting && <RejectModal request={request} onDecide={onDecide} onClose={() => setRejecting(false)} />}
    </Space>
  )
}

// Заявки на согласование. requests — GET /me/approvals (pending первыми, затем недавние решения).
// onDecide(request, approve, comment) -> Promise<boolean> (родитель делает запрос и показывает сообщения; true — успех).
export default function ApprovalsList({ requests, onDecide }) {
  const [rejecting, setRejecting] = useState(null)
  const pending = requests.filter((r) => r.status === 'pending')
  const history = requests.filter((r) => r.status !== 'pending')

  const common = [
    { title: s.list.person, dataIndex: 'personName' },
    { title: s.list.period, render: (_, r) => periodText(r) },
    { title: s.list.kind, dataIndex: 'kind', render: (k) => s.kinds[k] },
    { title: s.list.days, dataIndex: 'days', width: 70 },
  ]
  const messageCol = {
    title: s.list.message,
    dataIndex: 'message',
    render: (m) => (m ? <Typography.Text style={{ maxWidth: 280 }} ellipsis={{ tooltip: m }}>{m}</Typography.Text> : strings.none),
  }
  const pendingColumns = [
    ...common,
    messageCol,
    {
      title: strings.actions,
      render: (_, r) => (
        <Space size={4}>
          <Popconfirm title={s.approvals.approveConfirm} okText={s.approvals.approve} cancelText={s.list.cancelNo} onConfirm={() => onDecide(r, true)}>
            <Button size="small" type="primary">
              {s.approvals.approve}
            </Button>
          </Popconfirm>
          <Button size="small" danger onClick={() => setRejecting(r)}>
            {s.approvals.reject}
          </Button>
        </Space>
      ),
    },
  ]
  const historyColumns = [
    ...common,
    { title: s.list.status, dataIndex: 'status', render: (st) => <StatusTag status={st} /> },
    { title: s.list.decision, render: (_, r) => r.decisionComment ?? strings.none },
  ]

  return (
    <Space orientation="vertical" size={24} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={5}>{s.approvals.pending}</Typography.Title>
        <Table rowKey="id" size="small" columns={pendingColumns} dataSource={pending} pagination={false} locale={{ emptyText: s.approvals.emptyPending }} scroll={{ x: 'max-content' }} />
      </div>
      <div>
        <Typography.Title level={5}>{s.approvals.history}</Typography.Title>
        <Table rowKey="id" size="small" columns={historyColumns} dataSource={history} pagination={false} locale={{ emptyText: s.approvals.emptyHistory }} scroll={{ x: 'max-content' }} />
      </div>
      {rejecting && <RejectModal request={rejecting} onDecide={onDecide} onClose={() => setRejecting(null)} />}
    </Space>
  )
}
