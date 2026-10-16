import { useState } from 'react'
import { App, Form, Input, Modal } from 'antd'
import { api } from '../api/index.js'
import strings from '../strings.js'
import { validatePassword } from './validation.js'

const s = strings.admin.users

// Администратор задаёт новый пароль сотруднику (сброса по почте нет)
export default function ResetPasswordModal({ user, onClose }) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  const submit = async ({ password }) => {
    const problem = validatePassword(password)
    if (problem) {
      form.setFields([{ name: 'password', errors: [problem] }])
      return
    }
    setSaving(true)
    try {
      await api.post(`/admin/users/${user.id}/password`, { password })
      message.success(s.passwordSet)
      onClose()
    } catch (e) {
      message.error(e.message)
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={s.resetPasswordTitle(user.full_name)}
      okText={strings.save}
      cancelText={strings.cancel}
      confirmLoading={saving}
      onCancel={onClose}
      onOk={() => form.submit()}
    >
      <Form form={form} layout="vertical" onFinish={submit}>
        <Form.Item name="password" label={s.newPassword} extra={s.passwordHint}>
          <Input.Password autoComplete="new-password" autoFocus />
        </Form.Item>
      </Form>
    </Modal>
  )
}
