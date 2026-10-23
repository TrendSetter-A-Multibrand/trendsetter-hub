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
const TABS = [
  { key: 'people', label: strings.tabs.people, Component: PeopleTab },
  { key: 'submissions', label: strings.tabs.submissions, badge: 'pending', Component: SubmissionsTab },
  { key: 'leave', label: strings.tabs.leave, badge: 'leavePending', Component: LeavesTab },
  { key: 'fields', label: strings.tabs.fields, Component: FieldsTab },
  { key: 'policies', label: strings.tabs.policies, Component: PoliciesTab },
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
        items={TABS.map(({ key, label, badge, Component }) => ({
          key,
          label: badge ? (
            <span>
              {label} <Badge count={badges[badge]} overflowCount={99} style={{ marginLeft: 4 }} />
            </span>
          ) : (
            label
          ),
          children: <Component pending={pending} onChanged={onChanged} />,
        }))}
      />
    </div>
  )
}
