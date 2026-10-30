import { Navigate, Route, Routes } from 'react-router-dom'
import RequireAuth from './auth/RequireAuth.jsx'
import RequireAdmin from './auth/RequireAdmin.jsx'
import OnboardingGate from './auth/OnboardingGate.jsx'
import AppLayout from './layout/AppLayout.jsx'
import LoginPage from './pages/LoginPage.jsx'
import HubPage from './pages/HubPage.jsx'
import ModulePage from './pages/ModulePage.jsx'
import NotFoundPage from './pages/NotFoundPage.jsx'
import OfficePage from './pages/OfficePage.jsx'
import OnboardingPage from './pages/OnboardingPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="onboarding" element={<OnboardingPage />} />
        <Route element={<OnboardingGate />}>
          <Route element={<AppLayout />}>
            <Route index element={<HubPage />} />
            <Route path="modules/:moduleId" element={<ModulePage />} />
            <Route path="office" element={<OfficePage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route element={<RequireAdmin />}>
              <Route path="admin" element={<Navigate to="/profile?section=admin" replace />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  )
}
