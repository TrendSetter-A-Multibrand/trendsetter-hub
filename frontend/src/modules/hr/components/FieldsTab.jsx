import { useState } from 'react'
import { Alert, App, Button, Form, Input, Modal, Select, Space, Spin, Switch, Table, Tag, Tooltip, Typography } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons'
import { api } from '../../../core/api/index.js'
import coreStrings from '../../../core/strings.js'
import strings from '../strings.js'
import { useLoad } from '../lib/useLoad.js'

const s = strings.fields
const BASE = '/modules/team/hr/fields'
const KEY_RE = /^[a-z][a-z0-9_]{1,40}$/
// photo создаётся только системно
const KIND_OPTIONS = ['text', 'textarea', 'select', 'chips', 'links'].map((k) => ({ value: k, label: s.kinds[k] }))

function FieldModal({ field, onClose, onSaved }) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const isEdit = Boolean(field)
  const kind = Form.useWatch('kind', form) ?? field?.kind

  const submit = async (v) => {
    const options = (v.options ?? []).map((o) => o.trim()).filter(Boolean)
    if (kind === 'select' && options.length === 0) {
      form.setFields([{ name: 'options', errors: [s.optionsRequired] }])
      return
    }
    const common = { label: v.label.trim(), hint: v.hint?.trim() || null, required: Boolean(v.required) }
    setSaving(true)
    try {
      if (isEdit) {
        await api.patch(`${BASE}/${field.id}`, kind === 'select' ? { ...common, options } : common)
        message.success(s.updated)
      } else {
        await api.post(BASE, { ...common, key: v.key, kind: v.kind, ...(kind === 'select' ? { options } : {}) })
        message.success(s.created)
      }
      await onSaved()
    } catch (e) {
      message.error(e.message)
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={isEdit ? s.editTitle(field.label) : s.addTitle}
      okText={coreStrings.save}
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
          key: field?.key,
          kind: field?.kind ?? 'text',
          label: field?.label ?? '',
          hint: field?.hint ?? '',
          required: field?.required ?? false,
          options: field?.options ?? [],
        }}
      >
        <Form.Item
          name="key"
          label={s.key}
          extra={isEdit ? s.immutableNote : s.keyHint}
          rules={[{ pattern: KEY_RE, required: !isEdit, message: s.keyInvalid }]}
        >
          <Input disabled={isEdit} />
        </Form.Item>
        <Form.Item name="kind" label={s.kind}>
          {isEdit ? <Select disabled options={Object.entries(s.kinds).map(([value, label]) => ({ value, label }))} /> : <Select options={KIND_OPTIONS} />}
        </Form.Item>
        <Form.Item name="label" label={s.label} rules={[{ required: true, whitespace: true, message: s.labelRequired }]}>
          <Input />
        </Form.Item>
        <Form.Item name="hint" label={s.hint}>
          <Input />
        </Form.Item>
        {kind === 'select' && (
          <Form.Item name="options" label={s.options}>
            <Select mode="tags" tokenSeparators={[',']} placeholder={s.optionsPlaceholder} open={false} />
          </Form.Item>
        )}
        <Form.Item name="required" label={s.required} valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default function FieldsTab() {
  const { message } = App.useApp()
  const { data: fields, error, reload } = useLoad(BASE)
  const [modal, setModal] = useState(null) // { field? }

  if (error) return <Alert type="error" showIcon title={strings.loadFailed} description={error} />
  if (!fields) return <Spin />

  const run = async (request, okText) => {
    try {
      await request()
      if (okText) message.success(okText)
      reload()
    } catch (e) {
      message.error(e.message)
    }
  }

  const move = (index, delta) => {
    const ids = fields.map((f) => f.id)
    ;[ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]
    return run(() => api.patch(`${BASE}/reorder`, { ids }))
  }

  const columns = [
    {
      title: s.order,
      width: 90,
      render: (_, f, i) => (
        <Space.Compact>
          <Tooltip title={s.up}>
            <Button size="small" icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => move(i, -1)} />
          </Tooltip>
          <Tooltip title={s.down}>
            <Button size="small" icon={<ArrowDownOutlined />} disabled={i === fields.length - 1} onClick={() => move(i, 1)} />
          </Tooltip>
        </Space.Compact>
      ),
    },
    {
      title: s.label,
      render: (_, f) => (
        <div style={{ opacity: f.active ? 1 : 0.55 }}>
          <div>{f.label}</div>
          <Typography.Text type="secondary" code>
            {f.key}
          </Typography.Text>
          {f.hint && (
            <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
              {f.hint}
            </Typography.Text>
          )}
        </div>
      ),
    },
    { title: s.kind, render: (_, f) => s.kinds[f.kind] },
    {
      title: s.required,
      align: 'center',
      render: (_, f) => (f.required ? <Tag color="red">{s.required}</Tag> : strings.none),
    },
    {
      title: s.active,
      align: 'center',
      render: (_, f) => (
        <Tooltip title={f.isSystem ? s.systemCantHide : undefined}>
          <Switch
            size="small"
            checked={f.active}
            disabled={f.isSystem}
            onChange={(v) => run(() => api.patch(`${BASE}/${f.id}`, { active: v }), v ? s.shownToast : s.hiddenToast)}
          />
        </Tooltip>
      ),
    },
    {
      title: strings.actions,
      render: (_, f) => (
        <Space>
          {f.isSystem && <Tag>{s.system}</Tag>}
          {!f.active && <Tag>{s.hidden}</Tag>}
          <Button size="small" onClick={() => setModal({ field: f })}>
            {s.edit}
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <>
      <Space style={{ marginBottom: 16 }} align="center">
        <Button type="primary" onClick={() => setModal({})}>
          {s.add}
        </Button>
        <Typography.Text type="secondary">{s.hiddenNote}</Typography.Text>
      </Space>
      <Table rowKey="id" columns={columns} dataSource={fields} pagination={false} />
      {modal && (
        <FieldModal
          key={modal.field?.id ?? 'new'}
          field={modal.field ?? null}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null)
            reload()
          }}
        />
      )}
    </>
  )
}
