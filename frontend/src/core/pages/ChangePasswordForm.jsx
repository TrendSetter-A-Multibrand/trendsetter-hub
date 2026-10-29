import { useState } from 'react'
import { Alert, Button, Form, Input, Typography } from 'antd'
import { api, setToken } from '../api/index.js'
import { validatePasswordForm } from '../auth/passwordRules.js'
import strings from '../strings.js'

const s = strings.profile.settings.password

// Форма «Смена пароля» в «Настройках». Пароли живут только в полях формы и в теле запроса: не логируются, после ответа очищаются.
export default function ChangePasswordForm({ onChanged }) {
  const [form] = Form.useForm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  const submit = async (values) => {
    setDone(false)
    const problem = validatePasswordForm(values)
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setBusy(true)
    try {
      const { token } = await api.post('/auth/change-password', { oldPassword: values.oldPassword, newPassword: values.newPassword })
      setToken(token) // прежние сессии закрыты сервером: подменяем сохранённый токен на новый
      await onChanged?.()
      form.resetFields()
      setDone(true)
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  return (
    <div style={{ marginTop: 32 }}>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        {s.title}
      </Typography.Title>
      <Form form={form} layout="vertical" autoComplete="off" onFinish={submit} onValuesChange={() => setDone(false)}>
        <Form.Item name="oldPassword" label={s.old}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item name="newPassword" label={s.new} extra={s.hint}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item name="repeat" label={s.repeat}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
        {done && <Alert type="success" showIcon title={s.success} style={{ marginBottom: 16 }} />}
        <Button type="primary" htmlType="submit" loading={busy}>
          {s.submit}
        </Button>
      </Form>
    </div>
  )
}
