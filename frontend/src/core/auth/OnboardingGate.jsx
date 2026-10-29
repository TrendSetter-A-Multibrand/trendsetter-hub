import { Navigate, Outlet } from 'react-router-dom'
import { onboardingStep } from './onboarding.js'
import { useAuth } from './useAuth.js'

// Шлюз над AppLayout: пока у пользователя есть шаг онбординга, доступен только /onboarding.
export default function OnboardingGate() {
  const { me } = useAuth()
  if (onboardingStep(me)) return <Navigate to="/onboarding" replace />
  return <Outlet />
}
