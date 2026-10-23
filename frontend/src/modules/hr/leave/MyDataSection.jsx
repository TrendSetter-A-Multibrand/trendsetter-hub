import { useEffect, useState } from 'react'
import { Alert, Descriptions } from 'antd'
import { api } from '../../../core/api/index.js'
import { formatDate } from '../../../core/dates.js'
import strings from '../strings.js'

const s = strings.myData

const moneyFormatter = new Intl.NumberFormat('ru-RU')

// Блок «Моя зарплата» (решение Q-D5: сотрудник видит свой оклад). GET /modules/hr/me/compensation;
// ошибка/403/404 или нет карточки — блок тихо скрыт.
function MyPay() {
  const [pay, setPay] = useState(null)
  useEffect(() => {
    let alive = true
    api
      .get('/modules/hr/me/compensation')
      .then((r) => alive && setPay(r?.person ? { c: r.compensation } : null))
      .catch(() => alive && setPay(null))
    return () => {
      alive = false
    }
  }, [])
  if (!pay) return null
  const c = pay.c
  const days = [c?.payDay1, c?.payDay2].filter(Boolean).map(s.pay.payDay).join(', ')
  const items = []
  if (c?.salary != null) items.push({ key: 'salary', label: s.pay.salary, children: `${moneyFormatter.format(c.salary)}${c.currency ? ` ${c.currency}` : ''}` })
  if (days) items.push({ key: 'payDays', label: s.pay.payDays, children: days })
  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ marginBottom: 4 }}>{s.pay.title}</h3>
      <div style={{ opacity: 0.65, marginBottom: 8 }}>{s.pay.note}</div>
      {items.length ? <Descriptions bordered column={1} size="small" items={items} /> : <Alert type="warning" showIcon title={s.pay.empty} />}
    </div>
  )
}

// Раздел «Мои данные»: только чтение, основное досье + собственная зарплата, без документов.
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
      <MyPay />
    </div>
  )
}
