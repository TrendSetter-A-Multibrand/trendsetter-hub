import { useEffect, useState } from 'react'
import { Alert, DatePicker, Select, Space, Table, Typography } from 'antd'
import { api } from '../../../core/api/index.js'
import strings from '../strings.js'
import { useLoad } from '../lib/useLoad.js'
import { GROUP_KEYS, actionsOfGroup, auditQuery, formatAt, formatDetails } from '../lib/audit.js'

const s = strings.audit
const PAGE_SIZE = 50
const groupOptions = GROUP_KEYS.map((value) => ({ value, label: s.groups[value] }))

// Вкладка «Журнал» (группа «Безопасность»): кто что делал с карточками. Значения полей в журнал не попадают.
export default function AuditTab() {
  const [personId, setPersonId] = useState(null)
  const [group, setGroup] = useState(null)
  const [period, setPeriod] = useState(null) // { from, to }
  const [page, setPage] = useState(1)
  const [state, setState] = useState({ data: null, error: null, status: null, loadedQuery: null })
  const { data: people } = useLoad('/modules/team/hr/people')

  const query = auditQuery({ personId, action: actionsOfGroup(group), from: period?.from, to: period?.to, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
  useEffect(() => {
    let alive = true
    api
      .get(`/modules/hr/audit?${query}`)
      .then((data) => alive && setState({ data, error: null, status: null, loadedQuery: query }))
      .catch((e) => alive && setState((cur) => ({ ...cur, error: e.message, status: e.status ?? null, loadedQuery: query })))
    return () => {
      alive = false
    }
  }, [query])

  const change = (setter) => (value) => {
    setter(value)
    setPage(1)
  }

  if (state.error && !state.data) {
    return state.status === 403 ? (
      <Alert type="warning" showIcon title={s.forbidden} />
    ) : (
      <Alert type="error" showIcon title={s.loadFailed} description={state.error} />
    )
  }

  const columns = [
    { title: s.columns.at, dataIndex: 'at', width: 150, render: formatAt },
    { title: s.columns.who, dataIndex: 'userName', width: 180, render: (v) => v ?? strings.none },
    { title: s.columns.action, dataIndex: 'label', width: 260 },
    { title: s.columns.person, dataIndex: 'personName', width: 200, render: (v) => v ?? strings.none },
    { title: s.columns.details, dataIndex: 'details', render: (d) => formatDetails(d) || strings.none },
  ]

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Space wrap>
        <Select
          showSearch
          allowClear
          optionFilterProp="label"
          style={{ width: 280 }}
          aria-label={s.person}
          placeholder={s.personAll}
          value={personId}
          onChange={(v) => change(setPersonId)(v ?? null)}
          options={(people ?? []).map((p) => ({ value: p.id, label: p.name }))}
        />
        <Select
          allowClear
          style={{ width: 220 }}
          aria-label={s.actionGroup}
          placeholder={s.actionGroupAll}
          value={group}
          onChange={(v) => change(setGroup)(v ?? null)}
          options={groupOptions}
        />
        <DatePicker.RangePicker
          allowClear
          format="DD.MM.YYYY"
          placeholder={s.period}
          onChange={(range) =>
            change(setPeriod)(range?.[0] && range?.[1] ? { from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD') } : null)
          }
        />
      </Space>
      <Typography.Text type="secondary">
        {s.note}
      </Typography.Text>
      {state.error && <Alert type="error" showIcon title={s.loadFailed} description={state.error} />}
      <Table
        rowKey="id"
        size="small"
        loading={state.loadedQuery !== query}
        columns={columns}
        dataSource={state.data?.items ?? []}
        locale={{ emptyText: s.empty }}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total: state.data?.total ?? 0,
          showSizeChanger: false,
          showTotal: (n) => s.total(n),
          onChange: setPage,
        }}
      />
    </Space>
  )
}
