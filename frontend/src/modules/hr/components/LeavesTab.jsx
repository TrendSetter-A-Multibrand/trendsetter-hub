import { useState } from 'react'
import { Alert, App, Select, Space, Spin, Typography } from 'antd'
import { api } from '../../../core/api/index.js'
import strings from '../strings.js'
import { useLoad } from '../lib/useLoad.js'
import LeaveRequestList, { HrCancelButton } from '../leave/LeaveRequestList.jsx'
import { DecisionButtons } from '../leave/ApprovalsList.jsx'

const s = strings.leaveTab
const statusOptions = [
  { value: 'all', label: s.statusAll },
  ...Object.entries(strings.leave.statuses).map(([value, st]) => ({ value, label: st.label })),
]

// Вкладка «Отпуска»: все заявки, фильтр по статусу и сотруднику, решение за руководителя для заявок на согласовании.
// onChanged() — обновить бейджи (число во вкладке и в меню).
export default function LeavesTab({ onChanged }) {
  const { message } = App.useApp()
  const [status, setStatus] = useState('pending')
  const [personId, setPersonId] = useState(null)
  const { data: people } = useLoad('/modules/team/hr/people')
  const { data: requests, error, reload } = useLoad(`/modules/hr/leave/requests?status=${status}${personId === null ? '' : `&personId=${personId}`}`)

  const decide = async (request, approve, comment) => {
    try {
      await api.post(`/modules/hr/leave/requests/${request.id}/decision`, { approve, comment })
      message.success(approve ? s.approved : s.rejected)
      reload()
      await onChanged()
      return true
    } catch (e) {
      message.error(e.message)
      return false
    }
  }

  const cancel = async (request) => {
    try {
      await api.post(`/modules/hr/leave/requests/${request.id}/cancel`)
      message.success(s.cancelled)
      reload()
      await onChanged()
    } catch (e) {
      message.error(e.message)
    }
  }

  if (error && !requests) return <Alert type="error" showIcon title={strings.loadFailed} description={error} />
  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Space wrap>
        <Select style={{ width: 200 }} aria-label={s.status} value={status} onChange={setStatus} options={statusOptions} />
        <Select
          showSearch
          allowClear
          optionFilterProp="label"
          style={{ width: 280 }}
          placeholder={s.personAll}
          value={personId}
          onChange={(v) => setPersonId(v ?? null)}
          options={(people ?? []).map((p) => ({ value: p.id, label: p.name }))}
        />
      </Space>
      <Typography.Text type="secondary">{s.hint}</Typography.Text>
      {requests ? (
        <LeaveRequestList
          showPerson
          requests={requests}
          renderActions={(r) => (
            <Space size={4}>
              {r.status === 'pending' && <DecisionButtons request={r} onDecide={decide} />}
              <HrCancelButton request={r} onCancel={cancel} />
            </Space>
          )}
        />
      ) : (
        <Spin />
      )}
    </Space>
  )
}
