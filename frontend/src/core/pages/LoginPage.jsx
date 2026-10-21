import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Divider, Form, Input, Space, Typography } from 'antd'
import { api } from '../api/index.js'
import { DEMO_MODE } from '../config.js'
import { isValidEmail } from '../admin/validation.js'
import { useAuth } from '../auth/useAuth.js'
import strings from '../strings.js'

const s = strings.login

export default function LoginPage() {
  const { me, expired, login, demoLogin } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [demoUsers, setDemoUsers] = useState([])
  // После входа всегда открывается «Главная» (возврат на прежнюю страницу не используется)
  const target = '/'

  useEffect(() => {
    if (!DEMO_MODE) return
    api.get('/auth/demo-users').then(setDemoUsers).catch(() => setDemoUsers([]))
  }, [])

  if (me) return <Navigate to={target} replace />

  const run = async (action) => {
    setError(null)
    setSubmitting(true)
    try {
      await action()
      navigate(target, { replace: true })
    } catch (e) {
      setError(e.message)
      setSubmitting(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <Card style={{ width: 400, maxWidth: '100%' }}>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          {s.title}
        </Typography.Title>
        {expired && !error && <Alert type="warning" showIcon title={s.sessionExpired} style={{ marginBottom: 16 }} />}
        {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
        <Form layout="vertical" onFinish={({ email, password }) => run(() => login(email, password))}>
          <Form.Item
            name="email"
            label={s.email}
            rules={[
              { required: true, message: s.required },
              // TODO(Q-D): ограничение корпоративного домена не решено — проверяется только формат.
              { validator: (_, value) => (!value || isValidEmail(value) ? Promise.resolve() : Promise.reject(new Error(s.emailInvalid))) },
            ]}
          >
            <Input placeholder={s.emailPlaceholder} autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label={s.password} rules={[{ required: true, message: s.required }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            {s.submit}
          </Button>
        </Form>
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
          {s.resetNote}
        </Typography.Text>
        {DEMO_MODE && (
          <>
            <Divider>{s.demoTitle}</Divider>
            <Space wrap>
              {demoUsers.map((u) => (
                <Button key={u.id} disabled={submitting} onClick={() => run(() => demoLogin(u.id))}>
                  {u.full_name}
                </Button>
              ))}
            </Space>
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
              {s.demoHint}
            </Typography.Text>
          </>
        )}
      </Card>
    </div>
  )
}
