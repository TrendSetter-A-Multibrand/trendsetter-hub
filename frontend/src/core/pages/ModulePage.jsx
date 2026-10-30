import { Suspense } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { Spin } from 'antd'
import { useAuth } from '../auth/useAuth.js'
import { isModuleHidden, resolveRedirect } from '../access.js'
import { getModule } from '../../modules/registry.js'
import NotFoundPage from './NotFoundPage.jsx'
import ForbiddenPage from './ForbiddenPage.jsx'
import RoadmapPlaceholder from './RoadmapPlaceholder.jsx'

export default function ModulePage() {
  const { moduleId } = useParams()
  const { me } = useAuth()
  const module = getModule(moduleId)

  // redirect вычисляется первым (до hidden и доступа): старые адреса и ссылки из уведомлений
  const redirect = module ? resolveRedirect(module, me) : null
  if (redirect) return <Navigate to={redirect} replace />
  if (!module || isModuleHidden(module, me)) return <NotFoundPage />
  const access = me.module_access[module.id] ?? 'none'
  if (access === 'none') return <ForbiddenPage />
  if (module.status === 'roadmap' || module.Component === null) {
    return <RoadmapPlaceholder module={module} />
  }
  const { Component } = module
  return (
    <Suspense fallback={<Spin />}>
      <Component module={module} access={access} />
    </Suspense>
  )
}
