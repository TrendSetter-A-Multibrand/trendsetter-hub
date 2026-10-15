import { useEffect, useState } from 'react'
import { Select } from 'antd'
import { api } from '../api/index.js'
import { useAuth } from '../auth/useAuth.js'
import strings from '../strings.js'

export default function DemoUserSwitcher() {
  const { me, demoLogin } = useAuth()
  const [users, setUsers] = useState([])

  useEffect(() => {
    api.get('/auth/demo-users').then(setUsers).catch(() => setUsers([]))
  }, [])

  return (
    <Select
      size="small"
      style={{ width: 240 }}
      prefix={`${strings.layout.loginAs}:`}
      placeholder={strings.layout.loginAsPlaceholder}
      value={users.some((u) => u.id === me.id) ? me.id : undefined}
      onChange={(id) => demoLogin(id)}
      options={users.map((u) => ({ value: u.id, label: `${u.full_name} (${strings.levels[u.access_level]})` }))}
    />
  )
}
