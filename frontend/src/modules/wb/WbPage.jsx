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

function SectionStub({ s }) {
  return (
    <div className="stub">
      <div className="stub-body">
        <div className="stub-text">{s.sectionStub}</div>
      </div>
    </div>
  )
}

// Разделы переключаются только боковым меню (пункты под «Wildberries», ?section=<key>): своей строки вкладок на странице нет.
export default function WbPage({ module, access }) {
  const s = module.strings
  const [params] = useSearchParams()
  const key = SECTIONS.some((x) => x.key === params.get('section')) ? params.get('section') : SECTIONS[0].key
  const { Component } = SECTIONS.find((x) => x.key === key)
  const section = s.sections[key]
  return (
    <div className="stack module">
      <div className="module-head">
        <div>
          <div className="crumbs">
            <Link to="/">{coreStrings.layout.hub}</Link>
            <span>/</span>
            <Link to="/modules/wb">{s.pageTitle}</Link>
            <span>/</span>
            <span className="current">{section.label}</span>
          </div>
          <h1 className="h1">{section.label}</h1>
          <div className="subtitle">{section.description}</div>
        </div>
      </div>
      {/* key: при смене раздела состояние предыдущего не переносится (как destroyOnHidden у вкладок) */}
      {Component ? <Component key={key} module={module} access={access} /> : <SectionStub key={key} s={s} />}
    </div>
  )
}
