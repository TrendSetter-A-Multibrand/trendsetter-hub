import { Alert, Button, Drawer, Popconfirm, Space, Spin } from 'antd'
import strings from '../strings.js'
import ProfileForm from './ProfileForm.jsx'
import SubmissionStatus from './SubmissionStatus.jsx'
import { useMyProfileForm } from '../lib/useMyProfileForm.js'

const s = strings.profile

// Анкета сотрудника: форма по GET /fields, предзаполнена из GET /me (me — ответ /me, уже загруженный родителем).
// Любая отправка — заявка на проверку HR. onChanged() вызывается после отправки/изменения/отзыва.
export default function MyProfileDrawer({ me, onClose, onChanged }) {
  const form = useMyProfileForm({ me, onChanged, onDone: onClose })
  const { fields, loadError, busy, pending } = form

  return (
    <Drawer
      open
      size={560}
      title={s.title}
      onClose={onClose}
      footer={
        fields && (
          <Space>
            <Button type="primary" loading={busy} onClick={form.submit}>
              {pending ? s.update : s.send}
            </Button>
            {pending && (
              <Popconfirm title={s.cancelConfirm} okText={s.cancelYes} cancelText={s.cancelNo} onConfirm={form.cancelSubmission}>
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
          <SubmissionStatus submission={me.submission} />
          <Alert type="info" title={s.notice} style={{ marginBottom: 16 }} />
          <ProfileForm
            fields={fields}
            values={form.values}
            onChange={form.setValue}
            photo={form.photo}
            onPhoto={form.changePhoto}
            currentPhoto={me.photo}
            skip={form.skip}
            errors={form.errors}
            markRequired
          />
        </>
      )}
    </Drawer>
  )
}
