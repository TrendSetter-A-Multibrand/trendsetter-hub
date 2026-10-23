import { Alert, Card, Space, Statistic } from 'antd'
import { formatDate } from '../../../core/dates.js'
import strings from '../strings.js'

const s = strings.leave.balance

// Баланс отпуска: GET /modules/hr/me/leave -> balance + policy (и тот же вид в досье сотрудника у HR).
// balance === null — HR не указал дату приёма.
export default function LeaveBalance({ balance, policy }) {
  if (!balance) return <Alert type="info" showIcon title={s.noHiredAt} />
  const items = [
    { key: 'accrued', title: s.accrued, value: balance.accrued },
    { key: 'used', title: s.used, value: balance.used },
    { key: 'planned', title: s.planned, value: balance.planned },
    ...(balance.adjust !== 0 ? [{ key: 'adjust', title: s.adjust, value: balance.adjust }] : []),
    { key: 'available', title: s.available, value: balance.available, strong: true },
  ]
  return (
    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
      <Card size="small" title={s.title}>
        <Space size={32} wrap>
          {items.map((i) => (
            <Statistic
              key={i.key}
              title={i.title}
              value={i.value}
              precision={Number.isInteger(i.value) ? 0 : 2}
              styles={i.strong ? { content: { fontWeight: 600 } } : undefined}
            />
          ))}
        </Space>
      </Card>
      {balance.availableFrom && <Alert type="warning" showIcon title={s.availableFrom(formatDate(balance.availableFrom))} />}
      {policy && <div style={{ color: 'var(--muted)', fontSize: 13 }}>{s.policy(policy)}</div>}
    </Space>
  )
}
