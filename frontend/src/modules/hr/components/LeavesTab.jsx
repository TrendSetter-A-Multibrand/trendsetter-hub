import { useState } from 'react'
import { Alert, App, DatePicker, Select, Space, Spin, Typography } from 'antd'
import { api } from '../../../core/api/index.js'
import { countDays } from '../../../core/dates.js'
import strings from '../strings.js'
import { useLoad } from '../lib/useLoad.js'
import LeaveRequestList, { HrCancelButton } from '../leave/LeaveRequestList.jsx'
import { DecisionButtons } from '../leave/ApprovalsList.jsx'
import ExportButton from './ExportButton.jsx'

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
  const [period, setPeriod] = useState(null) // { from, to } для экспорта в Excel
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
        <DatePicker.RangePicker
          allowClear
          format="DD.MM.YYYY"
          placeholder={strings.exportXlsx.periodPlaceholder}
          onChange={(range) => setPeriod(range?.[0] && range?.[1] ? { from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD') } : null)}
          status={period && countDays(period.from, period.to) > 400 ? 'error' : undefined}
        />
        <ExportButton
          path={period ? `/modules/hr/export/leave?from=${period.from}&to=${period.to}` : ''}
          disabled={!period || countDays(period.from, period.to) > 400}
        />
        {period && countDays(period.from, period.to) > 400 && <Typography.Text type="danger">{strings.exportXlsx.periodTooLong}</Typography.Text>}
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
