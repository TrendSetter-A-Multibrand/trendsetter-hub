import { useState } from 'react'
import { App, Button, Form, Input, Modal, Select, Table, Tag, Typography } from 'antd'
import { api } from '../api/index.js'
import { GROUP_PERMISSIONS } from '../access.js'
import { useAuth } from '../auth/useAuth.js'
import strings from '../strings.js'
import { MODULES } from '../../modules/registry.js'
import { validateGroupName } from './validation.js'

const s = strings.admin.groups

const permissionOptions = ['none', ...GROUP_PERMISSIONS].map((p) => ({ value: p, label: strings.permissions[p] }))

function GroupModal({ group, groups, users, onClose, onSaved }) {
  const { message } = App.useApp()
  const { syncMe } = useAuth()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const isEdit = Boolean(group)

  const initialValues = {
    name: group?.name,
    user_ids: group?.user_ids ?? [],
    ...Object.fromEntries(MODULES.map((m) => [`perm_${m.id}`, group?.permissions?.[m.id] ?? 'none'])),
  }

  const submit = async (values) => {
    const nameError = validateGroupName(values.name, groups, group?.id)
    if (nameError) {
      form.setFields([{ name: 'name', errors: [nameError] }])
      return
    }
    const permissions = {}
    for (const m of MODULES) {
      const p = values[`perm_${m.id}`]
      if (p && p !== 'none') permissions[m.id] = p
    }
    const body = { name: values.name, permissions, user_ids: values.user_ids ?? [] }
    setSaving(true)
    try {
      if (isEdit) {
        await api.patch(`/admin/groups/${group.id}`, body)
        message.success(s.updated)
      } else {
        await api.post('/admin/groups', body)
        message.success(s.created)
      }
      await onSaved()
      await syncMe()
    } catch (e) {
      message.error(e.message)
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={isEdit ? s.editTitle : s.addTitle}
      okText={strings.save}
      cancelText={strings.cancel}
      confirmLoading={saving}
      onCancel={onClose}
      onOk={() => form.submit()}
    >
      <Form form={form} layout="vertical" onFinish={submit} initialValues={initialValues}>
        <Form.Item name="name" label={s.name}>
          <Input />
        </Form.Item>
        <Typography.Text strong>{s.modulesTitle}</Typography.Text>
        <div style={{ marginTop: 8 }}>
          {MODULES.map((m) => (
            <Form.Item key={m.id} name={`perm_${m.id}`} label={m.strings.name}>
              <Select options={permissionOptions} />
            </Form.Item>
          ))}
        </div>
        <Form.Item name="user_ids" label={s.members}>
          <Select
            mode="multiple"
            placeholder={s.membersPlaceholder}
            optionFilterProp="label"
            options={users.map((u) => ({
              value: u.id,
              label: u.is_active ? u.full_name : s.disabledUser(u.full_name),
            }))}
          />
        </Form.Item>
        <Typography.Text type="secondary">{s.hint}</Typography.Text>
      </Form>
    </Modal>
  )
}

export default function GroupsTab({ groups, users, reload }) {
  const [modal, setModal] = useState(null) // { group? }

  const columns = [
    { title: s.name, dataIndex: 'name' },
    {
      title: s.permissions,
      dataIndex: 'permissions',
      render: (permissions) => {
        const tags = MODULES.filter((m) => permissions[m.id]).map((m) => (
          <Tag key={m.id}>
            {m.strings.name}: {strings.permissions[permissions[m.id]]}
          </Tag>
        ))
        return tags.length ? tags : s.noPermissions
      },
    },
    { title: s.userCount, dataIndex: 'user_count', align: 'right' },
    {
      title: strings.admin.users.actions,
      render: (_, group) => (
        <Button size="small" onClick={() => setModal({ group })}>
          {s.edit}
        </Button>
      ),
    },
  ]

  return (
    <>
      <Button type="primary" style={{ marginBottom: 16 }} onClick={() => setModal({})}>
        {s.add}
      </Button>
      <Table rowKey="id" columns={columns} dataSource={groups} pagination={false} />
      {modal && (
        <GroupModal
          group={modal.group}
          groups={groups}
          users={users}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null)
            await reload()
          }}
        />
      )}
    </>
  )
}
