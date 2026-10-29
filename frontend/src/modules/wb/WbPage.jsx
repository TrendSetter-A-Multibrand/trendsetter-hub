import { useSearchParams } from 'react-router-dom'
import coreStrings from '../../core/strings.js'
import PageHead from '../../core/layout/PageHead.jsx'
import mascot from '../../core/layout/mascot.svg'
import MarkingTab from './marking/MarkingTab.jsx'

// Разделы модуля. Новый раздел = запись здесь + подпись в strings.sections; Component получает { module, access }.
// Без Component — заглушка «в разработке».
const SECTIONS = [
  { key: 'marking', Component: MarkingTab },
  { key: 'cards' },
  { key: 'seo' },
  { key: 'ads' },
  { key: 'pricing' },
]

function SectionStub({ module, section, s }) {
  return (
    <div className="stack module">
      <PageHead module={module} title={section.label} />
      <section className="stub" aria-label={coreStrings.roadmapTag}>
        <span className="stub-tag">[ {coreStrings.roadmapTag} ]</span>
        <h2 className="stub-title">{section.description}</h2>
        <p className="stub-text">{s.sectionStub}</p>
        <img className="stub-mascot" src={mascot} alt="" aria-hidden="true" />
      </section>
    </div>
  )
}

// Разделы переключаются только в левом меню (пункты под «Wildberries» ведут на ?section=<key>); на странице — выбранный раздел.
export default function WbPage({ module, access }) {
  const s = module.strings
  const [params] = useSearchParams()
  const current = SECTIONS.find((x) => x.key === params.get('section')) ?? SECTIONS[0]
  const { Component } = current
  return Component ? (
    <Component key={current.key} module={module} access={access} />
  ) : (
    <SectionStub module={module} section={s.sections[current.key]} s={s} />
  )
}
