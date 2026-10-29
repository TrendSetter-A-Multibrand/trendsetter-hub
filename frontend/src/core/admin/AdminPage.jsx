import { useCallback, useEffect, useState } from 'react'
import { Alert, Spin, Tabs } from 'antd'
import { api } from '../api/index.js'
import strings from '../strings.js'
import UsersTab from './UsersTab.jsx'
import DepartmentsTab from './DepartmentsTab.jsx'
import GroupsTab from './GroupsTab.jsx'
import OnboardingTab from './OnboardingTab.jsx'

export default function AdminPage() {
  const [users, setUsers] = useState(null)
  const [departments, setDepartments] = useState(null)
  const [groups, setGroups] = useState(null)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    try {
      const [u, d, g] = await Promise.all([
        api.get('/admin/users'),
        api.get('/admin/departments'),
        api.get('/admin/groups'),
      ])
      setUsers(u)
      setDepartments(d)
      setGroups(g)
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    Promise.all([api.get('/admin/users'), api.get('/admin/departments'), api.get('/admin/groups')])
      .then(([u, d, g]) => {
        setUsers(u)
        setDepartments(d)
        setGroups(g)
      })
      .catch((e) => setError(e.message))
  }, [])

  if (error) return <Alert type="error" showIcon title={strings.admin.loadFailed} description={error} />
  if (!users || !departments || !groups) return <Spin />

  return (
    <>
      <Tabs
        items={[
          {
            key: 'users',
            label: strings.admin.tabUsers,
            children: <UsersTab users={users} departments={departments} groups={groups} reload={reload} />,
          },
          {
            key: 'departments',
            label: strings.admin.tabDepartments,
            children: <DepartmentsTab departments={departments} reload={reload} />,
          },
          {
            key: 'groups',
            label: strings.admin.tabGroups,
            children: <GroupsTab groups={groups} users={users} reload={reload} />,
          },
          {
            key: 'onboarding',
            label: strings.admin.tabOnboarding,
            children: <OnboardingTab />,
          },
        ]}
      />
    </>
  )
}
