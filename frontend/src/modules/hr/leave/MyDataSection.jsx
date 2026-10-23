import { Alert, Descriptions } from 'antd'
import { formatDate } from '../../../core/dates.js'
import strings from '../strings.js'

const s = strings.myData

// Раздел «Мои данные»: только чтение, основное досье без денег и документов.
// data — GET /modules/hr/me/file ({ person, file }); TODO(Q-D6): эндпоинта нет в замороженном контракте.
export default function MyDataSection({ data }) {
  const f = data.file
  const items = [
    { key: 'legalName', label: s.legalName, children: f.legalName ?? strings.none },
    { key: 'hiredAt', label: s.hiredAt, children: f.hiredAt ? formatDate(f.hiredAt) : strings.none },
    { key: 'country', label: s.country, children: f.country ? s.countries[f.country] : strings.none },
    { key: 'workSchedule', label: s.workSchedule, children: f.workSchedule ?? strings.none },
  ]
  const empty = Object.values(f).every((v) => v === null)
  return (
    <div style={{ maxWidth: 640 }}>
      <Alert type="info" showIcon title={s.note} style={{ marginBottom: 16 }} />
      {empty ? <Alert type="warning" showIcon title={s.empty} /> : <Descriptions bordered column={1} size="small" items={items} />}
    </div>
  )
}
