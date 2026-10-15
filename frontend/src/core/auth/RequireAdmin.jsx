import { Outlet } from 'react-router-dom'
import { useAuth } from './useAuth.js'
import ForbiddenPage from '../pages/ForbiddenPage.jsx'

export default function RequireAdmin() {
  const { me } = useAuth()
  return me?.can_manage_users ? <Outlet /> : <ForbiddenPage />
}
