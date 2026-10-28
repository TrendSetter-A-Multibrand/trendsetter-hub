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

// Разделы — вкладки на странице и пункты под «Wildberries» в меню. Оба ведут на ?section=<key>, поэтому активный раздел всегда совпадает.
export default function WbPage({ module, access }) {
  const s = module.strings
  const [params, setParams] = useSearchParams()
  const key = SECTIONS.some((x) => x.key === params.get('section')) ? params.get('section') : SECTIONS[0].key
  return (
    <div className="stack module">
      <div className="module-head">
        <div>
          <div className="crumbs">
            <Link to="/">{coreStrings.layout.hub}</Link>
            <span>/</span>
            <span className="current">{s.dept}</span>
          </div>
          <h1 className="h1">{s.pageTitle}</h1>
          <div className="subtitle">{s.pageSubtitle}</div>
        </div>
      </div>
      <Tabs
        className="soft-tabs"
        destroyOnHidden
        activeKey={key}
        onChange={(next) => setParams({ section: next })}
        items={SECTIONS.map(({ key: k, Component }) => ({
          key: k,
          label: s.sections[k].label,
          children: Component ? <Component module={module} access={access} /> : <SectionStub section={s.sections[k]} s={s} />,
        }))}
      />
    </div>
  )
}
