// Реестр модулей. Порядок в MODULES = порядок вкладок меню и карточек хаба.
//
// Чек-лист нового модуля:
//   1. папка frontend/src/modules/<id>/ со своим strings.js (name, dept, tool, title, description и др.);
//   2. одна строка в MODULES ниже (отделы здесь НЕ указываются);
//   3. привязка к отделам — в данных (сейчас mock/data.js -> moduleDepartments);
//   4. (позже) бэкенд-манифест модуля.
import { lazy } from 'react'
import purchasingStrings from './purchasing/strings.js'
import wbStrings from './wb/strings.js'
import analyticsStrings from './analytics/strings.js'
import pricingStrings from './pricing/strings.js'
import warehouseStrings from './warehouse/strings.js'
import hrStrings from './hr/strings.js'
import teamStrings from './team/strings.js'

export const MODULES = [
  { id: 'purchasing', status: 'roadmap', strings: purchasingStrings, Component: lazy(() => import('./purchasing/PurchasingPage.jsx')) },
  { id: 'warehouse', status: 'mvp', wide: true, strings: warehouseStrings, Component: lazy(() => import('./warehouse/WarehousePage.jsx')) },
  { id: 'wb', status: 'roadmap', strings: wbStrings, Component: null },
  { id: 'analytics', status: 'roadmap', strings: analyticsStrings, Component: null },
  { id: 'pricing', status: 'roadmap', strings: pricingStrings, Component: null },
  { id: 'hr', status: 'mvp', wide: true, strings: hrStrings, Component: lazy(() => import('./hr/HrPage.jsx')) },
  // forAll: виден всем активным сотрудникам (просмотр), без привязки к отделу; анкета — в настройках профиля (позже)
  { id: 'team', status: 'mvp', forAll: true, wide: true, strings: teamStrings, Component: lazy(() => import('./team/TeamPage.jsx')) },
]

export const getModule = (id) => MODULES.find((m) => m.id === id)

// Разделы страницы профиля (/profile). Ядро само ничего не знает про модули: порядок вкладок = порядок здесь.
//   id        — значение ?section= в адресе;
//   label     — подпись вкладки;
//   load      — (api, me) => Promise с данными раздела (необязательно); ошибка/null = данных нет;
//   visible   — (me, data) => показывать ли раздел (data — результат load);
//   badge     — (data) => число рядом с названием (необязательно);
//   Component — получает { me, data, reload }; reload() перечитывает данные раздела и /core/me.
// Данные личные (карточка, отпуска): наблюдатель (viewer) их не видит.
const ownData = (request) => (api, me) => (me.access_level === 'viewer' ? Promise.resolve(null) : request(api).catch(() => null))

export const PROFILE_SECTIONS = [
  {
    id: 'form',
    label: teamStrings.profile.title,
    visible: (me) => ['view', 'run'].includes(me.module_access.team),
    Component: lazy(() => import('./team/components/MyProfileSection.jsx')),
  },
  {
    id: 'leave',
    label: hrStrings.profile.leave,
    load: ownData((api) => api.get('/modules/hr/me/leave')),
    visible: (me, data) => Boolean(data?.person),
    Component: lazy(() => import('./hr/leave/LeaveSection.jsx')),
  },
  {
    id: 'approvals',
    label: hrStrings.profile.approvals,
    load: ownData((api) => api.get('/modules/hr/me/approvals')),
    visible: (me, data) => Boolean(data?.length),
    badge: (data) => data.filter((r) => r.status === 'pending').length,
    Component: lazy(() => import('./hr/leave/ApprovalsSection.jsx')),
  },
  {
    id: 'data',
    label: hrStrings.profile.myData,
    load: ownData((api) => api.get('/modules/hr/me/file')),
    visible: (me, data) => Boolean(data?.file),
    Component: lazy(() => import('./hr/leave/MyDataSection.jsx')),
  },
]
