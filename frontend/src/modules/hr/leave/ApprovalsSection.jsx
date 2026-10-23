import { App } from 'antd'
import { api } from '../../../core/api/index.js'
import strings from '../strings.js'
import ApprovalsList from './ApprovalsList.jsx'

const s = strings.leave.approvals

// Раздел «На согласовании» страницы профиля (для руководителей). data — GET /modules/hr/me/approvals.
export default function ApprovalsSection({ data, reload }) {
  const { message } = App.useApp()

  const decide = async (request, approve, comment) => {
    try {
      await api.post(`/modules/hr/leave/requests/${request.id}/decision`, { approve, comment })
      message.success(approve ? s.approved : s.rejected)
      await reload()
      return true
    } catch (e) {
      message.error(e.message)
      await reload() // заявку могли обработать в другом месте (409) — список обновляется
      return false
    }
  }

  return <ApprovalsList requests={data} onDecide={decide} />
}
