import { useCallback, useEffect, useState } from 'react'
import { Badge, Tabs } from 'antd'
import { api } from '../../core/api/index.js'
import { useAuth } from '../../core/auth/useAuth.js'
import ForbiddenPage from '../../core/pages/ForbiddenPage.jsx'
import strings from './strings.js'
import SubmissionsTab from './components/SubmissionsTab.jsx'
import PeopleTab from './components/PeopleTab.jsx'
import FieldsTab from './components/FieldsTab.jsx'

// Вкладки модуля. Новая вкладка (отпуска, зарплаты…) = одна запись здесь. Component получает { pending, onChanged }.
// badge: 'pending' — показать число заявок на проверке рядом с названием.
const TABS = [
  { key: 'people', label: strings.tabs.people, Component: PeopleTab },
  { key: 'submissions', label: strings.tabs.submissions, badge: 'pending', Component: SubmissionsTab },
  { key: 'fields', label: strings.tabs.fields, Component: FieldsTab },
]

export default function HrPage({ access }) {
  const { syncMe } = useAuth()
  const [pending, setPending] = useState(0)

  const refreshPending = useCallback(async () => {
    try {
      setPending((await api.get('/modules/team/hr/pending-count')).count)
    } catch {
      // бейдж не критичен: остаётся прежнее число
    }
  }, [])

  useEffect(() => {
    if (access !== 'run') return
    api
      .get('/modules/team/hr/pending-count')
      .then((r) => setPending(r.count))
      .catch(() => {})
  }, [access])

  // после решения по заявке: число во вкладке и бейдж в меню/хабе (из /core/me)
  const onChanged = useCallback(async () => {
    await refreshPending()
    await syncMe()
  }, [refreshPending, syncMe])

  if (access !== 'run') return <ForbiddenPage />

  const badges = { pending }
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
