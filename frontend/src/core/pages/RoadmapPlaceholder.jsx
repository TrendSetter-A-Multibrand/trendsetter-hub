import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'
import { MODULES } from '../../modules/registry.js'
import strings from '../strings.js'
import PageHead from '../layout/PageHead.jsx'
import { moduleNumber } from '../layout/moduleNumber.js'
import SectionHead from '../layout/SectionHead.jsx'
import mascot from '../layout/mascot.svg'

// Модуль в разработке: жёлтая плашка с описанием и ссылки на модули, которые уже работают
export default function RoadmapPlaceholder({ module }) {
  const { me } = useAuth()
  const ready = MODULES.filter(
    (m) => !m.hidden && m.id !== module.id && m.status !== 'roadmap' && m.Component && (me.module_access[m.id] ?? 'none') !== 'none',
  )
  return (
    <div className="stack module">
      <PageHead module={module} title={module.strings.title} />
      <section className="stub" aria-label={strings.roadmapTag}>
        <span className="stub-tag">[ {strings.roadmapTag} ]</span>
        <h2 className="stub-title">{module.strings.description}</h2>
        <p className="stub-text">{strings.roadmap}</p>
        <img className="stub-mascot" src={mascot} alt="" aria-hidden="true" />
      </section>
      {ready.length > 0 && (
        <section className="section" aria-labelledby="stub-next">
          <SectionHead id="stub-next" title={strings.roadmapNext} />
          <div className="link-grid">
            {ready.map((m) => (
              <Link key={m.id} to={`/modules/${m.id}`} className="link-tile">
                <span className="link-tile-text">
                  <span className="link-tile-sub">
                    {moduleNumber(m.id)} · {m.strings.dept}
                  </span>
                  <span className="link-tile-name">{m.strings.tool}</span>
                </span>
                <span aria-hidden="true" className="link-tile-arrow">→</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
