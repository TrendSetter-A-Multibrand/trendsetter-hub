import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Spin } from 'antd'
import { useAuth } from './useAuth.js'

export default function RequireAuth() {
  const { me, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <Spin fullscreen />
  }
  if (!me) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }
  return <Outlet />
}
