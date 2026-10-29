import { useCallback, useEffect, useState } from 'react'
import { Alert, App, Button, Descriptions, Form, Input, Popconfirm, Space, Spin, Typography } from 'antd'
import { api } from '../api/index.js'
import { formatDateTime } from '../format.js'
import strings from '../strings.js'

const s = strings.admin.onboarding
const MIN_LEN = 12
const MAX_CHARS = 128
const MAX_BYTES = 72

// Клиентская проверка нового общего пароля (сервер проверяет так же). null — всё хорошо.
function validate({ password, repeat }) {
  const value = password ?? ''
  if ([...value].length < MIN_LEN) return s.tooShort
  if ([...value].length > MAX_CHARS || new TextEncoder().encode(value).length > MAX_BYTES) return s.tooLong
  if (value !== repeat) return s.mismatch
  return null
}

// Вкладка «Онбординг»: общий стартовый пароль для новых сотрудников. Значение нигде не показывается и не логируется:
// живёт только в полях формы и теле запроса, после ответа поля очищаются. Очистка пароля = пустой пароль в запросе (самосоздание выключено).
export default function OnboardingTab() {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [info, setInfo] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => api.get('/admin/onboarding').then(setInfo).catch((e) => setLoadError(e.message)), [])
  useEffect(() => {
    load()
  }, [load])

  const send = async (password, done) => {
    setError(null)
    setBusy(true)
    try {
      setInfo(await api.post('/admin/onboarding/password', { password }))
      message.success(done)
    } catch (e) {
      setError(e.message)
    }
    form.resetFields()
    setBusy(false)
  }

  const submit = (values) => {
    const problem = validate(values)
    if (problem) {
      setError(problem)
      return
    }
    return send(values.password, s.saved)
  }

  if (loadError) return <Alert type="error" showIcon title={strings.admin.loadFailed} description={loadError} />
  if (!info) return <Spin />

  const domains = info.domains ?? [info.domain]
  return (
    <div style={{ maxWidth: 560 }}>
      <Descriptions column={1} size="small" style={{ marginBottom: 24 }}>
        <Descriptions.Item label={s.passwordLabel}>
          {info.passwordSet ? s.passwordSet(info.updatedAt ? formatDateTime(info.updatedAt) : null, info.updatedBy) : s.passwordNotSet}
        </Descriptions.Item>
        <Descriptions.Item label={s.registeredLabel}>{s.registeredToday(info.registeredToday, info.dailyLimit)}</Descriptions.Item>
        <Descriptions.Item label={s.domainLabel}>{domains.map((d) => `@${d}`).join(', ')}</Descriptions.Item>
      </Descriptions>
      <Form form={form} layout="vertical" autoComplete="off" onFinish={submit}>
        <Form.Item name="password" label={s.newPassword} extra={s.hint}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item name="repeat" label={s.repeat}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
        <Space>
          <Button type="primary" htmlType="submit" loading={busy}>
            {s.submit}
          </Button>
          <Popconfirm title={s.clearConfirm} okText={s.clear} cancelText={strings.cancel} onConfirm={() => send('', s.cleared)}>
            <Button danger disabled={busy || !info.passwordSet}>
              {s.clear}
            </Button>
          </Popconfirm>
        </Space>
      </Form>
      <Typography.Paragraph type="secondary" style={{ marginTop: 24 }}>
        {s.memo(domains, info.ttlDays)}
      </Typography.Paragraph>
    </div>
  )
}
