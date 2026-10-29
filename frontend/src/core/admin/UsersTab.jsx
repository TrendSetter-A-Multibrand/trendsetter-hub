import { useEffect, useMemo, useState } from 'react'
import { App, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Tooltip, Typography } from 'antd'
import { api } from '../api/index.js'
import { ACCESS_LEVELS } from '../access.js'
import { useAuth } from '../auth/useAuth.js'
import strings from '../strings.js'
import { validateUserForm, validationMessages } from './validation.js'
import ResetPasswordModal from './ResetPasswordModal.jsx'
import UserPermissionsModal from './UserPermissionsModal.jsx'

const s = strings.admin.users

// Какому полю формы принадлежит текст ошибки валидации.
const FIELD_BY_MESSAGE = {
  [validationMessages.emailInvalid]: 'email',
  [validationMessages.emailDuplicate]: 'email',
  [validationMessages.fullNameEmpty]: 'full_name',
  [validationMessages.levelInvalid]: 'access_level',
  [validationMessages.passwordInvalid]: 'password',
}

function UserModal({ mode, user, users, departments, onClose, onSaved }) {
  const { message } = App.useApp()
  const { me, refreshMe } = useAuth()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const level = Form.useWatch('access_level', form)
  const isSelf = mode === 'edit' && user.id === me.id
  const [staff, setStaff] = useState([])

  // Список сотрудников для подстановки: только те, у кого ещё нет пользователя; сбой загрузки список просто скрывает
  useEffect(() => {
    if (mode !== 'add') return
    api.get('/modules/team/hr/people').then((people) => setStaff(people), () => {})
  }, [mode])
  const staffOptions = useMemo(() => {
    const taken = new Set(users.map((u) => u.email.toLowerCase()))
    return staff
      .filter((p) => !p.isArchived && !p.userId && !(p.email && taken.has(p.email.toLowerCase())))
      .map((p) => ({ value: p.id, label: p.title ? `${p.name} — ${p.title}` : p.name, person: p }))
  }, [staff, users])

  const pickStaff = (_, option) => {
    const p = option.person
    form.setFieldsValue({ full_name: `${p.firstName} ${p.lastName}`.trim(), email: p.email ?? '' })
    form.setFields([{ name: 'full_name', errors: [] }, { name: 'email', errors: [] }])
  }

  const submit = async (values) => {
    if (mode === 'add') {
      const problem = validateUserForm(values, users)
      if (problem) {
        form.setFields([{ name: FIELD_BY_MESSAGE[problem], errors: [problem] }])
        return
      }
    }
    setSaving(true)
    try {
      if (mode === 'add') {
        await api.post('/admin/users', { ...values, department_ids: values.department_ids ?? [] })
        message.success(s.created)
      } else {
        const body = { department_ids: values.department_ids ?? [] }
        if (!isSelf) body.access_level = values.access_level
        await api.patch(`/admin/users/${user.id}`, body)
        message.success(s.updated)
        if (isSelf) await refreshMe()
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
      title={mode === 'add' ? s.addTitle : s.editTitle}
      okText={strings.save}
      cancelText={strings.cancel}
      confirmLoading={saving}
      onCancel={onClose}
      onOk={() => form.submit()}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={submit}
        initialValues={
          mode === 'edit'
            ? { access_level: user.access_level ?? undefined, department_ids: user.department_ids }
            : { department_ids: [] }
        }
      >
        {mode === 'add' && (
          <>
            {staffOptions.length > 0 && (
              <Form.Item label={s.pickStaff} extra={s.pickStaffHint}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  allowClear
                  placeholder={s.pickStaffPlaceholder}
                  options={staffOptions}
                  onSelect={pickStaff}
                />
              </Form.Item>
            )}
            <Form.Item name="full_name" label={s.fullName}>
              <Input />
            </Form.Item>
            <Form.Item name="email" label={s.email}>
              <Input autoComplete="off" />
            </Form.Item>
            <Form.Item name="password" label={s.password}>
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          </>
        )}
        <Form.Item name="access_level" label={s.level} extra={level ? strings.levelDescriptions[level] : undefined}>
          <Select
            disabled={isSelf}
            placeholder={s.levelPlaceholder}
            options={ACCESS_LEVELS.map((l) => ({ value: l, label: strings.levels[l] }))}
          />
        </Form.Item>
        <Form.Item name="department_ids" label={s.departments}>
          <Select
            mode="multiple"
            placeholder={s.departmentsPlaceholder}
            options={departments.map((d) => ({ value: d.id, label: d.name }))}
          />
        </Form.Item>
        {mode === 'add' && <Typography.Text type="secondary">{s.passwordHint}</Typography.Text>}
      </Form>
    </Modal>
  )
}

// Завершение онбординга администратором без анкеты: уровень (все четыре, обязательный) и отделы
function FinishOnboardingModal({ user, departments, onClose, onSaved }) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const level = Form.useWatch('access_level', form)

  const submit = async (values) => {
    setSaving(true)
    try {
      await api.post(`/admin/users/${user.id}/onboarding/finish`, { access_level: values.access_level, department_ids: values.department_ids ?? [] })
      message.success(s.finished)
      await onSaved()
    } catch (e) {
      message.error(e.message)
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={s.finishTitle(user.full_name)}
      okText={s.finish}
      cancelText={strings.cancel}
      confirmLoading={saving}
      onCancel={onClose}
      onOk={() => form.submit()}
    >
      <Typography.Paragraph type="secondary">{s.finishHint}</Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={submit} initialValues={{ department_ids: [] }}>
        <Form.Item
          name="access_level"
          label={s.level}
          rules={[{ required: true, message: s.finishLevelRequired }]}
          extra={level ? strings.levelDescriptions[level] : undefined}
        >
          <Select placeholder={s.levelPlaceholder} options={ACCESS_LEVELS.map((l) => ({ value: l, label: strings.levels[l] }))} />
        </Form.Item>
        <Form.Item name="department_ids" label={s.departments}>
          <Select mode="multiple" placeholder={s.departmentsPlaceholder} options={departments.map((d) => ({ value: d.id, label: d.name }))} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

const isExpired = (user) => Boolean(user.must_change_password && user.onboarding_expires_at && new Date(user.onboarding_expires_at) < new Date())

export default function UsersTab({ users, departments, groups, reload }) {
  const { message } = App.useApp()
  const { me } = useAuth()
  const [modal, setModal] = useState(null) // { mode: 'add' } | { mode: 'edit', user }
  const [resetFor, setResetFor] = useState(null)
  const [rightsFor, setRightsFor] = useState(null)
  const [finishFor, setFinishFor] = useState(null)

  const toggleActive = async (user) => {
    try {
      await api.patch(`/admin/users/${user.id}`, { is_active: !user.is_active })
      message.success(user.is_active ? s.disabledDone : s.enabledDone)
      await reload()
    } catch (e) {
      message.error(e.message)
    }
  }

  const onboardingAction = async (user, action, done) => {
    try {
      await api.post(`/admin/users/${user.id}/onboarding/${action}`)
      message.success(done)
      await reload()
    } catch (e) {
      message.error(e.message)
    }
  }

  const columns = [
    { title: s.fullName, dataIndex: 'full_name' },
    { title: s.email, dataIndex: 'email' },
    {
      title: s.level,
      dataIndex: 'access_level',
      render: (level) => (level ? <Tag>{strings.levels[level]}</Tag> : strings.dash),
    },
    {
      title: s.departments,
      dataIndex: 'department_ids',
      render: (ids) =>
        ids.length === 0
          ? strings.dash
          : ids.map((id) => <Tag key={id}>{departments.find((d) => d.id === id)?.name ?? id}</Tag>),
    },
    {
      title: s.groups,
      dataIndex: 'id',
      render: (id) => {
        const own = groups.filter((g) => g.user_ids.includes(id))
        return own.length === 0 ? strings.dash : own.map((g) => <Tag key={g.id}>{g.name}</Tag>)
      },
    },
    {
      title: s.status,
      dataIndex: 'is_active',
      render: (active, user) => (
        <>
          <Tag color={active ? 'green' : 'default'}>{active ? s.active : s.disabled}</Tag>
          {user.onboarding && <Tag color={isExpired(user) ? 'red' : 'blue'}>{isExpired(user) ? s.onboardingExpiredTag : s.onboardingTag}</Tag>}
        </>
      ),
    },
    {
      title: s.actions,
      render: (_, user) => (
        <Space size={4} wrap>
          <Button size="small" onClick={() => setModal({ mode: 'edit', user })}>
            {s.edit}
          </Button>
          <Button size="small" onClick={() => setRightsFor(user)}>
            {s.specialRights}
          </Button>
          <Button size="small" onClick={() => setResetFor(user)}>
            {s.resetPassword}
          </Button>
          {user.id === me.id ? (
            <Tooltip title={s.cannotDisableSelf}>
              <Button size="small" disabled>
                {s.disable}
              </Button>
            </Tooltip>
          ) : (
            <Popconfirm
              title={user.is_active ? s.confirmDisable(user.full_name) : s.confirmEnable(user.full_name)}
              okText={user.is_active ? s.disable : s.enable}
              cancelText={strings.cancel}
              onConfirm={() => toggleActive(user)}
            >
              <Button size="small">{user.is_active ? s.disable : s.enable}</Button>
            </Popconfirm>
          )}
          {user.onboarding && user.must_change_password && (
            <Popconfirm
              title={s.extendConfirm(user.full_name)}
              okText={s.extend}
              cancelText={strings.cancel}
              onConfirm={() => onboardingAction(user, 'extend', s.extended)}
            >
              <Button size="small">{s.extend}</Button>
            </Popconfirm>
          )}
          {user.onboarding && !user.must_change_password && (
            <Button size="small" onClick={() => setFinishFor(user)}>
              {s.finish}
            </Button>
          )}
          {user.onboarding && user.id !== me.id && (
            <Popconfirm
              title={s.deleteConfirm}
              okText={s.deleteYes}
              okButtonProps={{ danger: true }}
              cancelText={strings.cancel}
              onConfirm={() => onboardingAction(user, 'delete', s.deleted)}
            >
              <Button size="small" danger>
                {s.deleteOnboarding}
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  return (
    <>
      <Button type="primary" style={{ marginBottom: 16 }} onClick={() => setModal({ mode: 'add' })}>
        {s.add}
      </Button>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={users}
        pagination={false}
        onRow={(user) => ({ style: user.is_active ? undefined : { opacity: 0.5 } })}
      />
      {resetFor && <ResetPasswordModal user={resetFor} onClose={() => setResetFor(null)} />}
      {rightsFor && <UserPermissionsModal user={rightsFor} onClose={() => setRightsFor(null)} />}
      {finishFor && (
        <FinishOnboardingModal
          user={finishFor}
          departments={departments}
          onClose={() => setFinishFor(null)}
          onSaved={async () => {
            setFinishFor(null)
            await reload()
          }}
        />
      )}
      {modal && (
        <UserModal
          mode={modal.mode}
          user={modal.user}
          users={users}
          departments={departments}
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
