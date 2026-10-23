import { Alert } from 'antd'
import strings from '../strings.js'

const s = strings.profile

// Статус последней заявки на анкету (поле submission из GET /modules/team/me)
export default function SubmissionStatus({ submission }) {
  if (!submission) return <Alert type="info" showIcon title={s.statusNone} style={{ marginBottom: 16 }} />
  if (submission.status === 'pending') return <Alert type="warning" showIcon title={s.statusPending} style={{ marginBottom: 16 }} />
  if (submission.status === 'rejected') {
    return <Alert type="error" showIcon title={s.statusRejected} description={`${s.rejectReason} ${submission.reviewComment}`} style={{ marginBottom: 16 }} />
  }
  return <Alert type="success" showIcon title={s.statusApproved} style={{ marginBottom: 16 }} />
}
