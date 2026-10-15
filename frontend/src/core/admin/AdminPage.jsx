import { useCallback, useEffect, useState } from 'react'
import { Alert, Spin, Tabs, Typography } from 'antd'
import { api } from '../api/index.js'
import strings from '../strings.js'
import UsersTab from './UsersTab.jsx'
import DepartmentsTab from './DepartmentsTab.jsx'

export default function AdminPage() {
  const [users, setUsers] = useState(null)
  const [departments, setDepartments] = useState(null)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    try {
      const [u, d] = await Promise.all([api.get('/admin/users'), api.get('/admin/departments')])
      setUsers(u)
      setDepartments(d)
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    Promise.all([api.get('/admin/users'), api.get('/admin/departments')])
      .then(([u, d]) => {
        setUsers(u)
        setDepartments(d)
      })
      .catch((e) => setError(e.message))
  }, [])

  if (error) return <Alert type="error" showIcon title={strings.admin.loadFailed} description={error} />
  if (!users || !departments) return <Spin />

  return (
    <>
      <Typography.Title level={2} style={{ marginTop: 0 }}>
        {strings.admin.title}
      </Typography.Title>
      <Tabs
        items={[
          {
            key: 'users',
            label: strings.admin.tabUsers,
            children: <UsersTab users={users} departments={departments} reload={reload} />,
          },
          {
            key: 'departments',
            label: strings.admin.tabDepartments,
            children: <DepartmentsTab departments={departments} reload={reload} />,
          },
        ]}
      />
    </>
  )
}
