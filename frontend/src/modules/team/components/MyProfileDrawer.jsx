import { useEffect, useState } from 'react'
import { Alert, App, Button, Drawer, Popconfirm, Space, Spin } from 'antd'
import { api } from '../../../core/api/index.js'
import strings from '../strings.js'
import ProfileForm from './ProfileForm.jsx'
import { buildValues, validateProfile } from '../lib/profile.js'

const s = strings.profile

function StatusAlert({ submission }) {
  if (!submission) return <Alert type="info" showIcon title={s.statusNone} style={{ marginBottom: 16 }} />
  if (submission.status === 'pending') return <Alert type="warning" showIcon title={s.statusPending} style={{ marginBottom: 16 }} />
  if (submission.status === 'rejected') {
    return <Alert type="error" showIcon title={s.statusRejected} description={`${s.rejectReason} ${submission.reviewComment}`} style={{ marginBottom: 16 }} />
  }
  return <Alert type="success" showIcon title={s.statusApproved} style={{ marginBottom: 16 }} />
}

// Анкета сотрудника: форма по GET /fields, предзаполнена из GET /me (me — ответ /me, уже загруженный родителем).
// Любая отправка — заявка на проверку HR. onChanged() вызывается после отправки/изменения/отзыва.
export default function MyProfileDrawer({ me, onClose, onChanged }) {
  const { message } = App.useApp()
  const [fields, setFields] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [values, setValues] = useState(() => ({ ...me.values }))
  const [photo, setPhoto] = useState(null)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    api
      .get('/modules/team/fields')
      .then((r) => alive && setFields(r))
      .catch((e) => alive && setLoadError(e.message))
    return () => {
      alive = false
    }
  }, [])

  const pending = me.submission?.status === 'pending'
  // manager_claim нужен только для новой карточки (у существующей руководитель уже назначен)
  const skip = me.person ? ['manager_claim'] : []
  const hasPhoto = Boolean(photo || me.photo || me.person?.hasPhoto)

  const setValue = (key, v) => {
    setValues((cur) => ({ ...cur, [key]: v }))
    setErrors((cur) => (cur[key] ? { ...cur, [key]: undefined } : cur))
  }

  const run = async (action, okText) => {
    setBusy(true)
    try {
      await action()
      message.success(okText)
      onChanged()
      onClose()
    } catch (e) {
      message.error(e.message)
      setBusy(false)
    }
  }

  const submit = () => {
    const found = validateProfile(fields, values, { skip, hasPhoto })
    setErrors(found)
    if (Object.values(found).some(Boolean)) return message.error(s.fixErrors)
    const body = { values: buildValues(fields, values, skip), photo: photo ?? null }
    return run(() => (pending ? api.patch('/modules/team/me/submission', body) : api.post('/modules/team/me/submission', body)), pending ? s.updated : s.sent)
  }

  const cancelSubmission = () => run(() => api.post('/modules/team/me/submission/cancel'), s.cancelled)

  return (
    <Drawer
      open
      size={560}
      title={s.title}
      onClose={onClose}
      footer={
        fields && (
          <Space>
            <Button type="primary" loading={busy} onClick={submit}>
              {pending ? s.update : s.send}
            </Button>
            {pending && (
              <Popconfirm title={s.cancelConfirm} okText={s.cancelYes} cancelText={s.cancelNo} onConfirm={cancelSubmission}>
                <Button danger disabled={busy}>
                  {s.cancelSubmission}
                </Button>
              </Popconfirm>
            )}
            <Button onClick={onClose}>{s.close}</Button>
          </Space>
        )
      }
    >
      {loadError && <Alert type="error" showIcon title={s.loadError} description={loadError} />}
      {!fields && !loadError && <Spin />}
      {fields && (
        <>
          <StatusAlert submission={me.submission} />
          <Alert type="info" title={s.notice} style={{ marginBottom: 16 }} />
          <ProfileForm
            fields={fields}
            values={values}
            onChange={setValue}
            photo={photo}
            onPhoto={(v) => {
              setPhoto(v)
              setErrors((cur) => ({ ...cur, photo: undefined }))
            }}
            currentPhoto={me.photo}
            skip={skip}
            errors={errors}
            markRequired
          />
        </>
      )}
    </Drawer>
  )
}
