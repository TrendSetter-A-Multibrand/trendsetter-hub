import { Alert, Button, Popconfirm, Space, Spin } from 'antd'
import strings from '../strings.js'
import ProfileForm from './ProfileForm.jsx'
import SubmissionStatus from './SubmissionStatus.jsx'
import { useMyProfile } from '../lib/useTeamMap.js'
import { useMyProfileForm } from '../lib/useMyProfileForm.js'

const s = strings.profile

function Form({ me, onChanged, onboarding }) {
  const form = useMyProfileForm({ me, onChanged })
  const { fields, loadError, busy, pending } = form
  if (loadError) return <Alert type="error" showIcon title={s.loadError} description={loadError} />
  if (!fields) return <Spin />
  return (
    <div style={{ maxWidth: 640 }}>
      {!onboarding && !me.person && <Alert type="warning" showIcon title={s.noCardNotice} style={{ marginBottom: 16 }} />}
      {(!onboarding || me.submission) && <SubmissionStatus submission={me.submission} />}
      {!onboarding && <Alert type="info" title={s.notice} style={{ marginBottom: 16 }} />}
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
      </Space>
    </div>
  )
}

// Раздел «Моя анкета» страницы профиля: та же форма, что в карте команды, встроенная (не drawer).
// После отправки/отзыва анкета перечитывается; форма пересоздаётся, когда меняется заявка (id или статус).
// onboarding: экран первого входа — общую подсказку показывает страница, лишние подсказки скрыты.
export default function MyProfileSection({ onboarding = false }) {
  const { me, reload } = useMyProfile(true)
  if (!me) return <Spin />
  return <Form key={`${me.submission?.id ?? 0}-${me.submission?.status ?? ''}`} me={me} onChanged={reload} onboarding={onboarding} />
}
