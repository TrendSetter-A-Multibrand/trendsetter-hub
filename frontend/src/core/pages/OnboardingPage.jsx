import { Suspense, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Button, Steps } from 'antd'
import { DEMO_MODE } from '../config.js'
import { ONBOARDING_PROFILE_FORM } from '../../modules/registry.js'
import { onboardingStep } from '../auth/onboarding.js'
import { useAuth } from '../auth/useAuth.js'
import DemoUserSwitcher from '../layout/DemoUserSwitcher.jsx'
import Logo from '../layout/Logo.jsx'
import PageHead from '../layout/PageHead.jsx'
import strings from '../strings.js'
import ChangePasswordForm from './ChangePasswordForm.jsx'

const s = strings.onboarding

// Экран первого входа: без меню, колокольчика и профиля. После одобрения HR syncMe обновит me, и переход на главную произойдёт сам.
export default function OnboardingPage() {
  const { me, logout, refreshMe } = useAuth()
  const [formKey, setFormKey] = useState(0)
  const step = onboardingStep(me)
  if (!step) return <Navigate to="/" replace />
  const ProfileForm = ONBOARDING_PROFILE_FORM

  const checkStatus = async () => {
    await refreshMe()
    setFormKey((k) => k + 1) // форма анкеты пересоздаётся и перечитывает статус
  }

  return (
    <div className="onboarding-shell">
      <div className="onboarding-bar">
        <div className="onboarding-logo">
          <Logo />
        </div>
        <div className="onboarding-bar-actions">
          {DEMO_MODE && (
            <>
              <span className="demo-flag">{strings.layout.demoData}</span>
              <DemoUserSwitcher />
            </>
          )}
          <span className="mono-label">{me.email}</span>
          <Button onClick={logout}>{strings.layout.logout}</Button>
        </div>
      </div>
      <main className="stack onboarding">
        <PageHead eyebrow={s.eyebrow} title={s.title} subtitle={step === 'password' ? s.passwordHint : s.profileHint} />
        <Steps current={step === 'password' ? 0 : 1} items={[{ title: s.steps.password }, { title: s.steps.profile }]} />
        {step === 'password' ? (
          <ChangePasswordForm onChanged={refreshMe} />
        ) : (
          <>
            <div>
              <Button onClick={checkStatus}>{s.checkStatus}</Button>
            </div>
            <Suspense fallback={null}>
              <ProfileForm key={formKey} onboarding />
            </Suspense>
          </>
        )}
      </main>
    </div>
  )
}
