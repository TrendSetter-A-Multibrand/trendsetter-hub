import { Suspense, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Button, Steps, Typography } from 'antd'
import { DEMO_MODE } from '../config.js'
import { ONBOARDING_PROFILE_FORM } from '../../modules/registry.js'
import { onboardingStep } from '../auth/onboarding.js'
import { useAuth } from '../auth/useAuth.js'
import DemoUserSwitcher from '../layout/DemoUserSwitcher.jsx'
import Logo from '../layout/Logo.jsx'
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
    <div style={{ minHeight: '100vh' }}>
      {DEMO_MODE && (
        <div className="demo-banner">
          <span className="dot" />
          <span>{strings.demoBanner}</span>
          <span className="switcher">
            <DemoUserSwitcher />
          </span>
        </div>
      )}
      <header style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 24px' }}>
        <div style={{ width: 136 }}>
          <Logo />
        </div>
        <Typography.Text type="secondary" style={{ marginLeft: 'auto' }}>
          {me.email}
        </Typography.Text>
        <Button onClick={logout}>{strings.layout.logout}</Button>
      </header>
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '8px 24px 48px' }}>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          {s.title}
        </Typography.Title>
        <Steps
          current={step === 'password' ? 0 : 1}
          items={[{ title: s.steps.password }, { title: s.steps.profile }]}
          style={{ marginBottom: 24 }}
        />
        {step === 'password' ? (
          <>
            <Typography.Paragraph>{s.passwordHint}</Typography.Paragraph>
            <ChangePasswordForm onChanged={refreshMe} />
          </>
        ) : (
          <>
            <Typography.Paragraph>{s.profileHint}</Typography.Paragraph>
            <Button onClick={checkStatus} style={{ marginBottom: 16 }}>
              {s.checkStatus}
            </Button>
            <Suspense fallback={null}>
              <ProfileForm key={formKey} />
            </Suspense>
          </>
        )}
      </main>
    </div>
  )
}
