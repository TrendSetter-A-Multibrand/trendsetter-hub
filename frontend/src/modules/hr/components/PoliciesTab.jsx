import { useState } from 'react'
import { Alert, App, Button, Form, InputNumber, Modal, Space, Spin, Table } from 'antd'
import { api } from '../../../core/api/index.js'
import { useAuth } from '../../../core/auth/useAuth.js'
import coreStrings from '../../../core/strings.js'
import strings from '../strings.js'
import { useLoad } from '../lib/useLoad.js'

const s = strings.policies
const decimal = (n) => String(n).replace('.', ',')

function PolicyModal({ policy, onSaved, onClose }) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  const submit = async (values) => {
    setSaving(true)
    try {
      await api.patch(`/modules/hr/leave/policies/${policy.country}`, values)
      message.success(s.saved)
      await onSaved()
    } catch (e) {
      message.error(e.message)
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={s.editTitle(s.countries[policy.country])}
      okText={coreStrings.save}
      cancelText={coreStrings.cancel}
      confirmLoading={saving}
      onCancel={onClose}
      onOk={() => form.submit()}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={submit}
        initialValues={{ daysPerYear: policy.daysPerYear, accruePerMonth: policy.accruePerMonth, firstLeaveAfterMonths: policy.firstLeaveAfterMonths }}
      >
        <Form.Item name="daysPerYear" label={s.daysPerYear} rules={[{ required: true, type: 'number' }]}>
          <InputNumber style={{ width: '100%' }} min={0} max={60} precision={2} />
        </Form.Item>
        <Form.Item name="accruePerMonth" label={s.accruePerMonth} rules={[{ required: true, type: 'number' }]}>
          <InputNumber style={{ width: '100%' }} min={0} max={10} precision={3} />
        </Form.Item>
        <Form.Item name="firstLeaveAfterMonths" label={s.firstLeaveAfterMonths} rules={[{ required: true, type: 'number' }]}>
          <InputNumber style={{ width: '100%' }} min={0} max={24} precision={0} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

// Вкладка «Нормы отпуска»: политики по странам. Правка — только ответственному (module_responsible.hr), иначе чтение.
export default function PoliciesTab() {
  const { me } = useAuth()
  const canEdit = me?.module_responsible?.hr === true
  const { data, error, reload } = useLoad('/modules/hr/leave/policies')
  const [editing, setEditing] = useState(null)

  if (error && !data) return <Alert type="error" showIcon title={strings.loadFailed} description={error} />
  if (!data) return <Spin />

  const columns = [
    { title: s.country, dataIndex: 'country', render: (c) => s.countries[c] ?? c },
    { title: s.daysPerYear, dataIndex: 'daysPerYear', render: decimal },
    { title: s.accruePerMonth, dataIndex: 'accruePerMonth', render: decimal },
    { title: s.firstLeaveAfterMonths, dataIndex: 'firstLeaveAfterMonths' },
    ...(canEdit
      ? [
          {
            title: strings.actions,
            render: (_, p) => (
              <Button size="small" onClick={() => setEditing(p)}>
                {s.edit}
              </Button>
            ),
          },
        ]
      : []),
  ]

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Alert type="warning" showIcon title={s.note} />
      {!canEdit && <Alert type="info" showIcon title={s.readOnly} />}
      <Table rowKey="country" size="small" columns={columns} dataSource={data} pagination={false} />
      {editing && (
        <PolicyModal
          policy={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await reload()
          }}
        />
      )}
    </Space>
  )
}
