import { useState } from 'react'
import { Alert, Button, Segmented, Spin, Table, Typography } from 'antd'
import strings from '../strings.js'
import { useLoad } from '../lib/useLoad.js'
import { formatDateTime } from '../../../core/format.js'
import SubmissionDrawer, { StatusTag } from './SubmissionDrawer.jsx'

const s = strings.submissions
const BASE = '/modules/team/hr'

const nameOf = (sub) => [sub.values.last_name, sub.values.first_name].filter(Boolean).join(' ') || sub.userName

export default function SubmissionsTab({ pending, onChanged }) {
  const subs = useLoad(`${BASE}/submissions?status=all`)
  const fields = useLoad(`${BASE}/fields`)
  const people = useLoad(`${BASE}/people`)
  const directions = useLoad(`${BASE}/directions`)
  const [mode, setMode] = useState('pending')
  const [openId, setOpenId] = useState(null)

  const error = subs.error ?? fields.error ?? people.error ?? directions.error
  if (error) return <Alert type="error" showIcon title={strings.loadFailed} description={error} />
  if (!subs.data || !fields.data || !people.data || !directions.data) return <Spin />

  const list = subs.data.filter((x) => (mode === 'pending' ? x.status === 'pending' : x.status !== 'pending'))
  const opened = subs.data.find((x) => x.id === openId) ?? null

  const columns = [
    { title: s.person, render: (_, x) => nameOf(x) },
    { title: s.status, render: (_, x) => <StatusTag status={x.status} /> },
    { title: s.sent, render: (_, x) => formatDateTime(x.createdAt) },
    ...(mode === 'history' ? [{ title: s.reviewed, render: (_, x) => (x.reviewedAt ? formatDateTime(x.reviewedAt) : strings.none) }] : []),
    { title: '', render: (_, x) => (x.personId === null ? <Typography.Text type="secondary">{s.newCard}</Typography.Text> : null) },
    {
      title: strings.actions,
      render: (_, x) => (
        <Button size="small" type={x.status === 'pending' ? 'primary' : 'default'} onClick={() => setOpenId(x.id)}>
          {s.open}
        </Button>
      ),
    },
  ]

  return (
    <>
      <Segmented
        style={{ marginBottom: 16 }}
        value={mode}
        onChange={setMode}
        options={[
          { value: 'pending', label: `${s.pending} (${pending})` },
          { value: 'history', label: s.history },
        ]}
      />
      <Table
        rowKey="id"
        columns={columns}
        dataSource={list}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        locale={{ emptyText: mode === 'pending' ? s.emptyPending : s.emptyHistory }}
      />
      {opened && (
        <SubmissionDrawer
          sub={opened}
          fields={fields.data}
          people={people.data}
          directions={directions.data}
          onClose={() => setOpenId(null)}
          onChanged={async () => {
            setOpenId(null)
            subs.reload()
            people.reload()
            await onChanged()
          }}
        />
      )}
    </>
  )
}
