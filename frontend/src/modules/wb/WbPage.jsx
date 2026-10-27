import { Link, useSearchParams } from 'react-router-dom'
import { Tabs } from 'antd'
import coreStrings from '../../core/strings.js'
import MarkingTab from './marking/MarkingTab.jsx'

// Разделы модуля. Новый раздел = запись здесь + подпись в strings.sections; Component получает { module, access }.
// Без Component — заглушка «в разработке».
const SECTIONS = [
  { key: 'marking', Component: MarkingTab },
  { key: 'cards' },
  { key: 'seo' },
  { key: 'ads' },
]

function SectionStub({ section, s }) {
  return (
    <div className="stub">
      <div className="stub-body">
        <h2 className="h2">{section.label}</h2>
        <div className="stub-text">
          {section.description}. {s.sectionStub}
        </div>
      </div>
    </div>
  )
}

export default function WbPage({ module, access }) {
  const s = module.strings
  // открытый раздел — в адресе (?section=), чтобы на него вёл пункт всплывающего меню
  const [params, setParams] = useSearchParams()
  const section = SECTIONS.some((x) => x.key === params.get('section')) ? params.get('section') : SECTIONS[0].key
  return (
    <div className="stack module">
      <div className="module-head">
        <div>
          <div className="crumbs mono">
            <Link to="/">{coreStrings.layout.hub}</Link>
            <span>/</span>
            <span className="current">{s.dept}</span>
          </div>
          <h1 className="h1">{s.pageTitle}</h1>
          <div className="subtitle">{s.pageSubtitle}</div>
        </div>
      </div>
      <Tabs
        destroyOnHidden
        activeKey={section}
        onChange={(key) => setParams({ section: key })}
        items={SECTIONS.map(({ key, Component }) => ({
          key,
          label: s.sections[key].label,
          children: Component ? <Component module={module} access={access} /> : <SectionStub section={s.sections[key]} s={s} />,
        }))}
      />
    </div>
  )
}
