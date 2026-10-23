import { Route, Routes } from 'react-router-dom'
import RequireAuth from './auth/RequireAuth.jsx'
import RequireAdmin from './auth/RequireAdmin.jsx'
import AppLayout from './layout/AppLayout.jsx'
import LoginPage from './pages/LoginPage.jsx'
import HubPage from './pages/HubPage.jsx'
import ModulePage from './pages/ModulePage.jsx'
import NotFoundPage from './pages/NotFoundPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import AdminPage from './admin/AdminPage.jsx'

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<HubPage />} />
          <Route path="modules/:moduleId" element={<ModulePage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route element={<RequireAdmin />}>
            <Route path="admin" element={<AdminPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
