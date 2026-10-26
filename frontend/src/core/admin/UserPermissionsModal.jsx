import { useEffect, useState } from 'react'
import { Alert, App, Form, Modal, Select, Spin } from 'antd'
import { api } from '../api/index.js'
import { GROUP_PERMISSIONS } from '../access.js'
import { useAuth } from '../auth/useAuth.js'
import strings from '../strings.js'
import { MODULES } from '../../modules/registry.js'

const s = strings.admin.users
const options = ['none', ...GROUP_PERMISSIONS].map((p) => ({ value: p, label: strings.permissions[p] }))

// «Особые права»: личное право на модуль (none/view/run/responsible), поверх групповых. PATCH принимает одну пару — шлём только изменённые.
export default function UserPermissionsModal({ user, onClose }) {
  const { message } = App.useApp()
  const { me, syncMe } = useAuth()
  const [form] = Form.useForm()
  const [initial, setInitial] = useState(null)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    api
      .get(`/admin/users/${user.id}/module-permissions`)
      .then((r) => alive && setInitial(Object.fromEntries(MODULES.map((m) => [m.id, r.permissions[m.id] ?? 'none']))))
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [user.id])

  const submit = async (values) => {
    setSaving(true)
    try {
      for (const m of MODULES) {
        if (values[m.id] === initial[m.id]) continue
        await api.patch(`/admin/users/${user.id}/module-permissions`, { moduleId: m.id, permission: values[m.id] === 'none' ? null : values[m.id] })
      }
      message.success(s.specialRightsSaved)
      if (user.id === me.id) await syncMe()
      onClose()
    } catch (e) {
      message.error(e.message)
      setSaving(false)
    }
  }

  return (
    <Modal open title={s.specialRightsTitle(user.full_name)} okText={strings.save} cancelText={strings.cancel} confirmLoading={saving} okButtonProps={{ disabled: !initial }} onCancel={onClose} onOk={() => form.submit()}>
      {error && <Alert type="error" showIcon title={s.specialRightsLoadFailed} description={error} />}
      {!initial && !error && <Spin />}
      {initial && (
        <Form form={form} layout="horizontal" labelCol={{ span: 10 }} initialValues={initial} onFinish={submit}>
          <Alert type="info" title={s.specialRightsHint} style={{ marginBottom: 16 }} />
          {MODULES.map((m) => (
            <Form.Item key={m.id} name={m.id} label={m.strings.tool} extra={m.strings.permissionHint}>
              <Select options={options} />
            </Form.Item>
          ))}
        </Form>
      )}
    </Modal>
  )
}
