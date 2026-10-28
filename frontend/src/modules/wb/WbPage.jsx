import { Link, useSearchParams } from 'react-router-dom'
import coreStrings from '../../core/strings.js'
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

function SectionStub({ section, s }) {
  return (
    <div className="stub">
      <div className="stub-body">
        <span className="stub-tag">{coreStrings.roadmapTag}</span>
        <h2 className="h2">{section.label}</h2>
        <div className="stub-text">
          {section.description}. {s.sectionStub}
        </div>
      </div>
    </div>
  )
}

// Разделы переключаются только в левом меню (пункты под «Wildberries» ведут на ?section=<key>); на странице — выбранный раздел.
export default function WbPage({ module, access }) {
  const s = module.strings
  const [params] = useSearchParams()
  const current = SECTIONS.find((x) => x.key === params.get('section')) ?? SECTIONS[0]
  const { Component } = current
  return (
    <div className="stack module">
      <div className="module-head">
        <div>
          <div className="crumbs">
            <Link to="/">{coreStrings.layout.hub}</Link>
            <span>/</span>
            <Link to={`/modules/${module.id}`}>{s.dept}</Link>
            <span>/</span>
            <span className="current">{s.sections[current.key].label}</span>
          </div>
          <h1 className="h1">{s.sections[current.key].label}</h1>
          <div className="subtitle">{s.sections[current.key].description}</div>
        </div>
      </div>
      {Component ? <Component key={current.key} module={module} access={access} /> : <SectionStub section={s.sections[current.key]} s={s} />}
    </div>
  )
}
