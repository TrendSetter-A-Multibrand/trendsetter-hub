import { Suspense } from 'react'
import { useParams } from 'react-router-dom'
import { Spin } from 'antd'
import { useAuth } from '../auth/useAuth.js'
import { getModule } from '../../modules/registry.js'
import NotFoundPage from './NotFoundPage.jsx'
import ForbiddenPage from './ForbiddenPage.jsx'
import RoadmapPlaceholder from './RoadmapPlaceholder.jsx'

export default function ModulePage() {
  const { moduleId } = useParams()
  const { me } = useAuth()
  const module = getModule(moduleId)

  if (!module || module.hidden) return <NotFoundPage />
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
