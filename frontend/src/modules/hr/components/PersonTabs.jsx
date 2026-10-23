import { Alert, Spin, Tabs } from 'antd'
import strings from '../strings.js'
import { useLoad } from '../lib/useLoad.js'
import DossierTab from './DossierTab.jsx'
import MoneyTab from './MoneyTab.jsx'
import PersonLeaveTab from './PersonLeaveTab.jsx'

const s = strings.person

// Вкладки модалки сотрудника. Досье и отпуск грузятся одним запросом (GET people/:id/file);
// «Деньги и документы» есть только если сервер вернул canSeeSensitive. card — содержимое вкладки «Карточка».
// Вкладки не уничтожаются при переключении, чтобы не терять несохранённые правки.
export default function PersonTabs({ person, tab, onTab, card }) {
  const { data, error, reload } = useLoad(`/modules/hr/people/${person.id}/file`)
  const wait = error && !data ? <Alert type="error" showIcon title={s.loadFailed} description={error} /> : <Spin />
  const items = [
    { key: 'card', label: s.tabs.card, children: card },
    { key: 'file', label: s.tabs.file, children: data ? <DossierTab person={person} file={data.file} reload={reload} /> : wait },
    ...(data?.canSeeSensitive ? [{ key: 'money', label: s.tabs.money, children: <MoneyTab person={person} /> }] : []),
    { key: 'leave', label: s.tabs.leave, children: data ? <PersonLeaveTab person={person} leave={data.leave} reload={reload} /> : wait },
  ]
  return <Tabs activeKey={tab} onChange={onTab} items={items} />
}
