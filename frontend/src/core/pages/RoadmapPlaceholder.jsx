import { Link } from 'react-router-dom'
import strings from '../strings.js'

export default function RoadmapPlaceholder({ module }) {
  return (
    <div className="stack module">
      <div className="crumbs">
        <Link to="/">{strings.layout.hub}</Link>
        <span>/</span>
        <span className="current">{module.strings.dept}</span>
      </div>
      <div className="stub">
        <div className="stub-body">
          <span className="stub-tag">{strings.roadmapTag}</span>
          <h1 className="h1">{module.strings.title}</h1>
          <div className="stub-text">
            {module.strings.description}. {strings.roadmap}
          </div>
        </div>
      </div>
    </div>
  )
}
