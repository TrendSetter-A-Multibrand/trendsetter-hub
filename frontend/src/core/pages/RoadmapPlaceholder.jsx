import { Link } from 'react-router-dom'
import { MODULES } from '../../modules/registry.js'
import strings from '../strings.js'

export default function RoadmapPlaceholder({ module }) {
  const idx = String(MODULES.findIndex((m) => m.id === module.id) + 1).padStart(2, '0')
  return (
    <div className="stack module">
      <div className="crumbs mono">
        <Link to="/">{strings.layout.hub}</Link>
        <span>/</span>
        <span className="current">{module.strings.dept}</span>
      </div>
      <div className="stub">
        <span className="corner tl">T</span>
        <span className="corner tr">R</span>
        <span className="corner bl">S</span>
        <span className="corner br">T</span>
        <div className="stub-body">
          <span className="stub-tag mono">
            [{idx}] {strings.moduleStatuses.roadmap}
          </span>
          <h1 className="h1">{module.strings.title}</h1>
          <div className="stub-text">
            {module.strings.description}. {strings.roadmap}
          </div>
        </div>
      </div>
    </div>
  )
}
