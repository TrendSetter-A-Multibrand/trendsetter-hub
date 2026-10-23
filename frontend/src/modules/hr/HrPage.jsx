import { useCallback, useEffect, useState } from 'react'
import { Badge, Tabs } from 'antd'
import { api } from '../../core/api/index.js'
import { useAuth } from '../../core/auth/useAuth.js'
import ForbiddenPage from '../../core/pages/ForbiddenPage.jsx'
import strings from './strings.js'
import SubmissionsTab from './components/SubmissionsTab.jsx'
import PeopleTab from './components/PeopleTab.jsx'
import FieldsTab from './components/FieldsTab.jsx'
import LeavesTab from './components/LeavesTab.jsx'
import PoliciesTab from './components/PoliciesTab.jsx'

// Вкладки модуля. Новая вкладка (зарплаты…) = одна запись здесь. Component получает { pending, onChanged }.
// badge: 'pending' — число анкет на проверке, 'leavePending' — число заявок на отпуск, ждущих решения, рядом с названием.
// group: ключ из strings.groups; вкладки одной группы должны идти подряд (новая группа, например «Зарплата» — новая запись + подпись в strings.groups).
const TABS = [
  { key: 'people', group: 'team', label: strings.tabs.people, Component: PeopleTab },
  { key: 'submissions', group: 'team', label: strings.tabs.submissions, badge: 'pending', Component: SubmissionsTab },
  { key: 'fields', group: 'team', label: strings.tabs.fields, Component: FieldsTab },
  { key: 'leave', group: 'leave', label: strings.tabs.leave, badge: 'leavePending', Component: LeavesTab },
  { key: 'policies', group: 'leave', label: strings.tabs.policies, Component: PoliciesTab },
]

export default function HrPage({ access }) {
  const { syncMe } = useAuth()
  const [pending, setPending] = useState(0)
  const [leavePending, setLeavePending] = useState(0)

  const refreshPending = useCallback(async () => {
    try {
      setPending((await api.get('/modules/team/hr/pending-count')).count)
    } catch {
      // бейдж не критичен: остаётся прежнее число
    }
  }, [])

  // бейдж вкладки «Отпуска» = заявки, ждущие HR (awaitingHr), как и бейдж модуля в меню
  const refreshLeavePending = useCallback(async () => {
    try {
      setLeavePending((await api.get('/modules/hr/leave/requests?status=pending')).filter((r) => r.awaitingHr).length)
    } catch {
      // бейдж не критичен
    }
  }, [])

  useEffect(() => {
    if (access !== 'run') return
    api
      .get('/modules/team/hr/pending-count')
      .then((r) => setPending(r.count))
      .catch(() => {})
    api
      .get('/modules/hr/leave/requests?status=pending')
      .then((r) => setLeavePending(r.filter((x) => x.awaitingHr).length))
      .catch(() => {})
  }, [access])

  // после решения по заявке: число во вкладке и бейдж в меню/хабе (из /core/me)
  const onChanged = useCallback(async () => {
    await Promise.all([refreshPending(), refreshLeavePending()])
    await syncMe()
  }, [refreshPending, refreshLeavePending, syncMe])

  if (access !== 'run') return <ForbiddenPage />

  const badges = { pending, leavePending }
  return (
    <div style={{ padding: '24px 40px' }}>
      <Tabs
        destroyOnHidden
        items={TABS.map(({ key, group, label, badge, Component }, i) => {
          // первая вкладка группы: тонкий разделитель слева (кроме самой первой) и mono-подпись группы
          const groupStart = group !== TABS[i - 1]?.group
          return {
            key,
            label: (
              <span
                style={groupStart && i > 0 ? { borderLeft: '1px solid #DDD7D4', paddingLeft: 16, marginLeft: 0 } : undefined}
              >
                {groupStart && (
                  <span className="mono" style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#8A8381', marginRight: 8 }}>
                    {strings.groups[group]}
                  </span>
                )}
                {label}
                {badge && <Badge count={badges[badge]} overflowCount={99} style={{ marginLeft: 8 }} />}
              </span>
            ),
            children: <Component pending={pending} onChanged={onChanged} />,
          }
        })}
      />
    </div>
  )
}
