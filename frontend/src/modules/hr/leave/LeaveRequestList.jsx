import { Button, Popconfirm, Table, Tag, Typography } from 'antd'
import { formatDate } from '../../../core/dates.js'
import strings from '../strings.js'
import { canCancelRequest, periodText } from './helpers.js'

const s = strings.leave

export function StatusTag({ status, awaitingHr }) {
  const st = s.statuses[status]
  return (
    <>
      <Tag color={st.color}>{st.label}</Tag>
      {awaitingHr && <Tag color="volcano">{s.leaveTab.awaitingHr}</Tag>}
    </>
  )
}

// Кнопка HR «Отменить» (любая pending/approved заявка) с подтверждением. onCancel(request) делает родитель.
export function HrCancelButton({ request, onCancel }) {
  if (request.status !== 'pending' && request.status !== 'approved') return null
  return (
    <Popconfirm title={s.leaveTab.cancelConfirm} okText={s.leaveTab.cancelYes} cancelText={s.leaveTab.cancelNo} onConfirm={() => onCancel(request)}>
      <Button size="small" danger>
        {s.leaveTab.cancel}
      </Button>
    </Popconfirm>
  )
}

// Список заявок на отпуск. onCancel(request) — если задан, показывается «Отозвать»; showPerson — колонка «Сотрудник» (HR);
// renderActions(request) — произвольные действия в последней колонке (HR: решение за руководителя).
export default function LeaveRequestList({ requests, onCancel, showPerson = false, renderActions }) {
  const columns = [
    ...(showPerson ? [{ title: s.list.person, dataIndex: 'personName' }] : []),
    { title: s.list.period, render: (_, r) => periodText(r) },
    { title: s.list.kind, dataIndex: 'kind', render: (k) => s.kinds[k] },
    { title: s.list.days, dataIndex: 'days', width: 70 },
    { title: s.list.status, dataIndex: 'status', render: (st, r) => <StatusTag status={st} awaitingHr={r.awaitingHr} /> },
    {
      title: s.list.message,
      dataIndex: 'message',
      render: (m) => (m ? <Typography.Text style={{ maxWidth: 260 }} ellipsis={{ tooltip: m }}>{m}</Typography.Text> : strings.none),
    },
    {
      title: s.list.decision,
      render: (_, r) =>
        r.decidedBy ? (
          <div>
            <div>{s.list.decidedBy(r.decidedBy, formatDate(r.decidedAt.slice(0, 10)))}</div>
            {r.decisionComment && <Typography.Text type="secondary">{r.decisionComment}</Typography.Text>}
          </div>
        ) : (
          strings.none
        ),
    },
    ...(onCancel
      ? [
          {
            title: strings.actions,
            width: 110,
            render: (_, r) =>
              canCancelRequest(r) && (
                <Popconfirm title={s.list.cancelConfirm} okText={s.list.cancelYes} cancelText={s.list.cancelNo} onConfirm={() => onCancel(r)}>
                  <Button size="small" danger>
                    {s.list.cancel}
                  </Button>
                </Popconfirm>
              ),
          },
        ]
      : []),
    ...(renderActions ? [{ title: strings.actions, render: (_, r) => renderActions(r) }] : []),
  ]
  return <Table rowKey="id" size="small" columns={columns} dataSource={requests} pagination={false} locale={{ emptyText: s.list.empty }} scroll={{ x: 'max-content' }} />
}
