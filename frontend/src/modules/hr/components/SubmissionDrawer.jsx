import { useEffect, useState } from 'react'
import { Alert, App, Avatar, Button, Drawer, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography } from 'antd'
import { UserOutlined } from '@ant-design/icons'
import { api } from '../../../core/api/index.js'
import coreStrings from '../../../core/strings.js'
import strings from '../strings.js'
import { formatValue } from '../lib/values.js'
import { directionOptions, managerOptions } from '../lib/options.js'
import { useAutoChecklist } from '../lib/useAutoChecklist.js'
import AutoChecklistOption from './AutoChecklistOption.jsx'

const s = strings.submissions
const BASE = '/modules/team/hr'

const STATUS_COLORS = { pending: 'gold', approved: 'green', rejected: 'red' }
export const StatusTag = ({ status }) => <Tag color={STATUS_COLORS[status]}>{s.statuses[status]}</Tag>

// Полное фото: undefined — грузится, null — нет/не загрузилось
function usePhoto(path) {
  const [state, setState] = useState({ path: null, data: undefined })
  useEffect(() => {
    if (!path) return undefined
    let alive = true
    api
      .get(path)
      .then((r) => alive && setState({ path, data: r.data }))
      .catch(() => alive && setState({ path, data: null }))
    return () => {
      alive = false
    }
  }, [path])
  if (!path) return null
  return state.path === path ? state.data : undefined
}

function ApproveModal({ sub, people, directions, onClose, onDone }) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const chosenId = Form.useWatch('personId', form)
  const linkedId = sub.personId ?? chosenId ?? null
  const existing = sub.personId === null ? null : (people.find((p) => p.id === sub.personId) ?? null)
  // новая карточка создаётся, только если заявка не привязана ни к какой существующей
  const createsCard = (chosen) => sub.personId === null && !chosen
  const auto = useAutoChecklist('onboarding', { active: sub.personId === null })

  const fill = (p) =>
    form.setFieldsValue({
      directionId: p?.directionId,
      managerId: p?.managerId ?? undefined,
      tag: p?.tag ?? '',
      team: p?.team ?? '',
      showInMap: p?.showInMap ?? true,
    })

  const submit = async (v) => {
    const body = { directionId: v.directionId, tag: v.tag?.trim() || null, team: v.team?.trim() || null, showInMap: v.showInMap }
    if (sub.personId === null && v.personId) body.personId = v.personId
    if (v.managerId !== undefined && v.managerId !== null) body.managerId = v.managerId
    setSaving(true)
    try {
      const person = await api.post(`${BASE}/submissions/${sub.id}/approve`, body)
      message.success(s.approved)
      if (createsCard(v.personId)) await auto.run(person?.id) // заявка уже одобрена: сбой запуска её не откатывает
      await onDone()
    } catch (e) {
      message.error(e.message)
      setSaving(false)
    }
  }

  const unlinked = people.filter((p) => !p.userId && !p.isArchived).map((p) => ({ value: p.id, label: `${p.name} · ${p.title}` }))
  const required = linkedId === null
  return (
    <Modal
      open
      title={s.approveTitle}
      okText={s.approve}
      cancelText={coreStrings.cancel}
      confirmLoading={saving}
      onCancel={onClose}
      onOk={() => form.submit()}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={submit}
        initialValues={{
          directionId: existing?.directionId,
          managerId: existing?.managerId ?? undefined,
          tag: existing?.tag ?? '',
          team: existing?.team ?? '',
          showInMap: existing?.showInMap ?? true,
        }}
      >
        {sub.personId === null && (
          <Form.Item name="personId" label={s.linkPerson} extra={s.linkPersonHint}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={s.linkPersonPlaceholder}
              options={unlinked}
              onChange={(id) => fill(people.find((p) => p.id === id))}
            />
          </Form.Item>
        )}
        <Form.Item name="directionId" label={s.direction} rules={[{ required, message: s.directionRequired }]}>
          <Select options={directionOptions(directions)} />
        </Form.Item>
        <Form.Item name="managerId" label={s.manager} rules={[{ required, message: s.managerRequired }]}>
          <Select showSearch optionFilterProp="label" options={managerOptions(people, linkedId === null ? [] : [linkedId])} />
        </Form.Item>
        <Space style={{ display: 'flex' }} align="start">
          <Form.Item name="tag" label={s.tag}>
            <Input />
          </Form.Item>
          <Form.Item name="team" label={s.team}>
            <Input />
          </Form.Item>
        </Space>
        <Form.Item name="showInMap" label={s.showInMap} valuePropName="checked">
          <Switch />
        </Form.Item>
        {createsCard(chosenId) && <AutoChecklistOption auto={auto} />}
      </Form>
    </Modal>
  )
}

function RejectModal({ sub, onClose, onDone }) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  const submit = async (v) => {
    setSaving(true)
    try {
      await api.post(`${BASE}/submissions/${sub.id}/reject`, { comment: v.comment.trim() })
      message.success(s.rejected)
      await onDone()
    } catch (e) {
      message.error(e.message)
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={s.rejectTitle}
      okText={s.reject}
      okButtonProps={{ danger: true }}
      cancelText={coreStrings.cancel}
      confirmLoading={saving}
      onCancel={onClose}
      onOk={() => form.submit()}
    >
      <Form form={form} layout="vertical" onFinish={submit}>
        <Form.Item name="comment" label={s.rejectComment} rules={[{ required: true, whitespace: true, message: s.rejectCommentRequired }]}>
          <Input.TextArea rows={4} maxLength={500} showCount />
        </Form.Item>
      </Form>
    </Modal>
  )
}

function PhotoBox({ label, src, loading }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <Avatar shape="square" size={160} src={src ?? undefined} icon={loading ? undefined : <UserOutlined />} />
      <div>
        <Typography.Text type="secondary">{label}</Typography.Text>
      </div>
    </div>
  )
}

// Заявка: значения рядом с текущими, фото, решение
export default function SubmissionDrawer({ sub, fields, people, directions, onClose, onChanged }) {
  const [dialog, setDialog] = useState(null) // 'approve' | 'reject'
  const newPhoto = usePhoto(sub.hasPhoto ? `${BASE}/submissions/${sub.id}/photo` : null)
  const person = sub.personId === null ? null : people.find((p) => p.id === sub.personId)
  const currentPhoto = usePhoto(person?.hasPhoto ? `${BASE}/people/${person.id}/photo` : null)

  const rows = fields
    .filter((f) => f.kind !== 'photo')
    .map((f) => {
      const next = formatValue(f, sub.values[f.key])
      const cur = sub.current ? formatValue(f, sub.current[f.key]) : ''
      return { key: f.key, label: f.label, next, cur, changed: Boolean(sub.current) && f.key !== 'manager_claim' && next !== cur }
    })
    .filter((r) => r.next || r.cur)

  const cell = (changed) => ({ style: { background: changed ? '#FFF7E6' : undefined, whiteSpace: 'pre-wrap' } })
  const columns = [
    { title: s.fieldCol, dataIndex: 'label', width: 180, onCell: (r) => cell(r.changed) },
    { title: s.currentCol, dataIndex: 'cur', render: (v) => v || strings.none, onCell: (r) => cell(r.changed) },
    { title: s.newCol, dataIndex: 'next', render: (v) => v || strings.none, onCell: (r) => cell(r.changed) },
  ]
  const isPending = sub.status === 'pending'
  const name = [sub.values.last_name, sub.values.first_name].filter(Boolean).join(' ') || sub.userName
  const done = async () => {
    setDialog(null)
    await onChanged()
  }

  return (
    <Drawer
      open
      size={760}
      title={s.drawerTitle(name)}
      onClose={onClose}
      extra={<StatusTag status={sub.status} />}
      footer={
        isPending && (
          <Space>
            <Button type="primary" onClick={() => setDialog('approve')}>
              {s.approve}
            </Button>
            <Button danger onClick={() => setDialog('reject')}>
              {s.reject}
            </Button>
          </Space>
        )
      }
    >
      <Typography.Paragraph type="secondary">{s.userLine(sub.userName, sub.userEmail)}</Typography.Paragraph>
      {sub.status === 'rejected' && sub.reviewComment && (
        <Alert type="error" showIcon title={s.reviewComment} description={sub.reviewComment} style={{ marginBottom: 16 }} />
      )}
      <Typography.Title level={5}>{s.photoTitle}</Typography.Title>
      <Space size={24} align="start" style={{ marginBottom: 16 }}>
        {person && <PhotoBox label={s.photoCurrent} src={currentPhoto} loading={currentPhoto === undefined} />}
        {sub.hasPhoto ? (
          <PhotoBox label={s.photoNew} src={newPhoto} loading={newPhoto === undefined} />
        ) : (
          <Typography.Text type="secondary">{s.photoNotChanged}</Typography.Text>
        )}
      </Space>
      <Table rowKey="key" size="small" columns={columns} dataSource={rows} pagination={false} />
      {dialog === 'approve' && <ApproveModal sub={sub} people={people} directions={directions} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'reject' && <RejectModal sub={sub} onClose={() => setDialog(null)} onDone={done} />}
    </Drawer>
  )
}
