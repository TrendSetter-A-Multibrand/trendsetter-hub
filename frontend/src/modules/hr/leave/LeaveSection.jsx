import { useState } from 'react'
import { App, Button, Space, Typography } from 'antd'
import { api } from '../../../core/api/index.js'
import strings from '../strings.js'
import LeaveBalance from './LeaveBalance.jsx'
import LeaveRequestList from './LeaveRequestList.jsx'
import LeaveRequestModal from './LeaveRequestModal.jsx'

const s = strings.leave

// Раздел «Отпуск» страницы профиля. data — GET /modules/hr/me/leave; reload() перечитывает данные.
export default function LeaveSection({ data, reload }) {
  const { message } = App.useApp()
  const [modalOpen, setModalOpen] = useState(false)

  const create = async (body) => {
    await api.post('/modules/hr/me/leave/requests', body)
    await reload()
  }

  const cancel = async (request) => {
    try {
      await api.post(`/modules/hr/me/leave/requests/${request.id}/cancel`)
      message.success(s.list.cancelled)
      await reload()
    } catch (e) {
      message.error(e.message)
    }
  }

  return (
    <Space orientation="vertical" size={24} style={{ width: '100%' }}>
      <LeaveBalance balance={data.balance} policy={data.policy} />
      <div>
        <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            {s.list.title}
          </Typography.Title>
          <Button type="primary" onClick={() => setModalOpen(true)}>
            {s.request.open}
          </Button>
        </Space>
        <LeaveRequestList requests={data.requests} onCancel={cancel} />
      </div>
      {modalOpen && <LeaveRequestModal balance={data.balance} approver={data.approver} onSubmit={create} onClose={() => setModalOpen(false)} />}
    </Space>
  )
}
