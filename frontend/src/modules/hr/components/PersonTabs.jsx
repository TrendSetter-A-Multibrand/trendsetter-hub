import { Alert, Spin, Tabs } from 'antd'
import strings from '../strings.js'
import { useLoad } from '../lib/useLoad.js'
import DossierTab from './DossierTab.jsx'
import MoneyTab from './MoneyTab.jsx'
import PersonLeaveTab from './PersonLeaveTab.jsx'
import HistoryTab from './HistoryTab.jsx'
import EquipmentTab from './EquipmentTab.jsx'
import PersonChecklistsTab from './PersonChecklistsTab.jsx'

const s = strings.person

// Вкладки модалки сотрудника. Досье и отпуск грузятся одним запросом (GET people/:id/file);
// «Деньги и документы» есть только если сервер вернул canSeeSensitive. card — содержимое вкладки «Карточка».
// Вкладки не уничтожаются при переключении, чтобы не терять несохранённые правки.
export default function PersonTabs({ person, tab, onTab, card, users }) {
  const { data, error, reload } = useLoad(`/modules/hr/people/${person.id}/file`)
  const wait = error && !data ? <Alert type="error" showIcon title={s.loadFailed} description={error} /> : <Spin />
  const items = [
    { key: 'card', label: s.tabs.card, children: card },
    { key: 'file', label: s.tabs.file, children: data ? <DossierTab person={person} file={data.file} reload={reload} /> : wait },
    ...(data?.canSeeSensitive ? [{ key: 'money', label: s.tabs.money, children: <MoneyTab person={person} /> }] : []),
    { key: 'leave', label: s.tabs.leave, children: data ? <PersonLeaveTab person={person} leave={data.leave} reload={reload} /> : wait },
    { key: 'history', label: s.tabs.history, children: data ? <HistoryTab person={person} canSeeSensitive={data.canSeeSensitive} /> : wait },
    { key: 'equipment', label: s.tabs.equipment, children: <EquipmentTab person={person} /> },
    { key: 'checklists', label: s.tabs.checklists, children: <PersonChecklistsTab person={person} users={users} /> },
  ]
  return <Tabs activeKey={tab} onChange={onTab} items={items} />
}
