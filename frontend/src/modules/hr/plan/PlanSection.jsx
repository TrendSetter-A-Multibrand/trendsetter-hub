import { useState } from 'react'
import { Alert, App, Button, DatePicker, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd'
import { api } from '../../../core/api/index.js'
import coreStrings from '../../../core/strings.js'
import { countDays, formatDate, todayIso } from '../../../core/dates.js'
import strings from '../strings.js'
import { useLoad } from '../lib/useLoad.js'
import LeaveRequestModal from '../leave/LeaveRequestModal.jsx'

const s = strings.plan
const DATE_FORMAT = 'YYYY-MM-DD'
const COMMENT_LIMIT = 300
const BASE = '/modules/hr'

const periodText = (p) => `${formatDate(p.start)} — ${formatDate(p.end)}`
const StatusTag = ({ status }) => <Tag color={s.statuses[status]?.color}>{s.statuses[status]?.label ?? status}</Tag>

function AddModal({ maxYear, onClose, onDone }) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const range = Form.useWatch('range', form)
  const today = todayIso()
  const days = range?.[0] && range?.[1] ? countDays(range[0].format(DATE_FORMAT), range[1].format(DATE_FORMAT)) : null

  const submit = async (values) => {
    setSaving(true)
    try {
      await api.post(`${BASE}/me/leave/plans`, {
        start: values.range[0].format(DATE_FORMAT),
        end: values.range[1].format(DATE_FORMAT),
        comment: (values.comment ?? '').trim() || undefined,
      })
      message.success(s.added)
      onDone()
    } catch (e) {
      message.error(e.message)
      setSaving(false)
    }
  }

  return (
    <Modal open title={s.addTitle} okText={s.add} cancelText={coreStrings.cancel} confirmLoading={saving} onCancel={onClose} onOk={() => form.submit()}>
      <Form form={form} layout="vertical" onFinish={submit}>
        <Form.Item name="range" label={s.period} rules={[{ required: true, message: s.periodRequired }]} extra={days !== null ? s.daysCount(days) : undefined}>
          <DatePicker.RangePicker
            style={{ width: '100%' }}
            format="DD.MM.YYYY"
            disabledDate={(current) => Boolean(current) && (current.format(DATE_FORMAT) < today || current.year() > maxYear)}
          />
        </Form.Item>
        <Form.Item name="comment" label={s.comment} rules={[{ max: COMMENT_LIMIT, message: s.commentTooLong }]}>
          <Input.TextArea rows={3} placeholder={s.commentPlaceholder} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

// Блок руководителя «План команды»: показывается только если сервер вернул непустой ответ
function TeamPlan({ year }) {
  const { data } = useLoad(`${BASE}/me/leave/team-plan?year=${year}`)
  if (!data?.length) return null
  const columns = [
    { title: s.person, dataIndex: 'name' },
    { title: s.period, key: 'period', render: (_, p) => periodText(p) },
    { title: s.days, key: 'days', render: (_, p) => countDays(p.start, p.end) },
    { title: s.comment, dataIndex: 'comment', render: (v) => v ?? strings.none },
    { title: s.status, dataIndex: 'status', render: (st) => <StatusTag status={st} /> },
  ]
  return (
    <div>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        {s.teamTitle}
      </Typography.Title>
      <Typography.Paragraph type="secondary">{s.teamNote}</Typography.Paragraph>
      <Table size="small" rowKey={(p) => `${p.personId}-${p.start}`} dataSource={data} columns={columns} pagination={false} scroll={{ x: 'max-content' }} />
    </div>
  )
}

// Раздел «График отпусков» страницы профиля. data — GET /modules/hr/me/leave (баланс и согласующий для заявки); reload() перечитывает его.
export default function PlanSection({ data, reload }) {
  const { message } = App.useApp()
  const thisYear = Number(todayIso().slice(0, 4))
  const [year, setYear] = useState(thisYear)
  const [adding, setAdding] = useState(false)
  const [requesting, setRequesting] = useState(null)
  const { data: plans, error, reload: reloadPlans } = useLoad(`${BASE}/me/leave/plans?year=${year}`)

  const cancel = async (plan) => {
    try {
      await api.post(`${BASE}/me/leave/plans/${plan.id}/cancel`)
      message.success(s.cancelled)
      reloadPlans()
    } catch (e) {
      message.error(e.message)
    }
  }

  const createRequest = async (body) => {
    await api.post(`${BASE}/me/leave/plans/${requesting.id}/request`, { kind: body.kind, message: body.message })
    reloadPlans()
    await reload()
  }

  const columns = [
    { title: s.period, key: 'period', render: (_, p) => periodText(p) },
    { title: s.days, key: 'days', render: (_, p) => countDays(p.start, p.end) },
    { title: s.comment, dataIndex: 'comment', render: (v) => v ?? strings.none },
    { title: s.status, dataIndex: 'status', render: (st) => <StatusTag status={st} /> },
    {
      title: '',
      key: 'actions',
      render: (_, p) =>
        p.status === 'planned' && (
          <Space size="small">
            <Button size="small" type="primary" onClick={() => setRequesting(p)}>
              {s.createRequest}
            </Button>
            <Popconfirm title={s.cancelConfirm} okText={s.cancelYes} cancelText={s.cancelNo} onConfirm={() => cancel(p)}>
              <Button size="small">{s.cancel}</Button>
            </Popconfirm>
          </Space>
        ),
    },
  ]

  return (
    <Space orientation="vertical" size={24} style={{ width: '100%' }}>
      <div>
        <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }} wrap>
          <Space>
            <Typography.Title level={5} style={{ margin: 0 }}>
              {s.myTitle}
            </Typography.Title>
            <Select
              style={{ width: 100 }}
              aria-label={s.year}
              value={year}
              onChange={setYear}
              options={[thisYear, thisYear + 1].map((y) => ({ value: y, label: String(y) }))}
            />
          </Space>
          <Button type="primary" onClick={() => setAdding(true)}>
            {s.add}
          </Button>
        </Space>
        <Typography.Paragraph type="secondary">{s.note}</Typography.Paragraph>
        {error && !plans ? (
          <Alert type="error" showIcon title={s.loadFailed} description={error} />
        ) : (
          <Table
            size="small"
            rowKey="id"
            loading={!plans}
            dataSource={plans ?? []}
            columns={columns}
            pagination={false}
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: s.empty }}
          />
        )}
      </div>
      <TeamPlan year={year} />
      {adding && (
        <AddModal
          maxYear={thisYear + 1}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false)
            reloadPlans()
          }}
        />
      )}
      {requesting && (
        <LeaveRequestModal
          balance={data.balance}
          approver={data.approver}
          fixedRange={{ start: requesting.start, end: requesting.end }}
          texts={{ title: s.requestTitle, sent: s.requestSent, fixedPeriod: s.fixedPeriod }}
          onSubmit={createRequest}
          onClose={() => setRequesting(null)}
        />
      )}
    </Space>
  )
}
