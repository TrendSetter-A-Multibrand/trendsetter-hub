// Реестр модулей. Порядок в MODULES = порядок вкладок меню и карточек хаба.
//
// Чек-лист нового модуля:
//   1. папка frontend/src/modules/<id>/ со своим strings.js (name, dept, tool, title, description и др.);
//   2. одна строка в MODULES ниже (отделы здесь НЕ указываются);
//   3. привязка к отделам — в данных (сейчас mock/data.js -> moduleDepartments);
//   4. (позже) бэкенд-манифест модуля.
import { lazy } from 'react'
import { canSeeData } from '../core/access.js'
import purchasingStrings from './purchasing/strings.js'
import wbStrings from './wb/strings.js'
import analyticsStrings from './analytics/strings.js'
import pricingStrings from './pricing/strings.js'
import warehouseStrings from './warehouse/strings.js'
import hrStrings from './hr/strings.js'
import teamStrings from './team/strings.js'
import newsStrings from './news/strings.js'
import { canReadNews, isNewsEditor } from './news/lib/news.js'

// hidden: модуль есть в реестре (особые права, группы, права в /core/me), но не показывается в меню,
// а его страница /modules/<id> — «Не найдено». Нужен модулям без своей страницы (новости: блоки на главной и вкладка профиля).
export const MODULES = [
  { id: 'purchasing', status: 'roadmap', strings: purchasingStrings, Component: lazy(() => import('./purchasing/PurchasingPage.jsx')) },
  { id: 'warehouse', status: 'mvp', wide: true, strings: warehouseStrings, Component: lazy(() => import('./warehouse/WarehousePage.jsx')) },
  // sections: разделы модуля — всплывают в меню при наведении, ведут на /modules/<id>?section=<key>
  {
    id: 'wb', status: 'mvp', strings: wbStrings, Component: lazy(() => import('./wb/WbPage.jsx')),
    sections: Object.entries(wbStrings.sections).map(([key, v]) => ({ key, label: v.label })),
  },
  { id: 'analytics', status: 'roadmap', strings: analyticsStrings, Component: null },
  { id: 'pricing', status: 'roadmap', strings: pricingStrings, Component: null },
  { id: 'hr', status: 'mvp', wide: true, strings: hrStrings, Component: lazy(() => import('./hr/HrPage.jsx')) },
  // forAll: виден всем активным сотрудникам (просмотр), без привязки к отделу; анкета — в настройках профиля (позже)
  { id: 'team', status: 'mvp', forAll: true, wide: true, strings: teamStrings, Component: lazy(() => import('./team/TeamPage.jsx')) },
  // последней строкой: номера пунктов меню остальных модулей не сдвигаются
  // TODO(Q-N4): опции view/run у «Новостей» в особых правах и группах ни на что не влияют (кроме viewer через Q-G1)
  { id: 'news', status: 'mvp', hidden: true, forAll: true, strings: newsStrings, Component: null },
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
    id: 'plan',
    label: hrStrings.profile.plan,
    load: ownData((api) => api.get('/modules/hr/me/leave')),
    visible: (me, data) => Boolean(data?.person),
    Component: lazy(() => import('./hr/plan/PlanSection.jsx')),
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
  {
    // только документы, отмеченные HR; раздел скрыт, если у сотрудника нет карточки
    id: 'documents',
    label: hrStrings.profile.documents,
    load: ownData(async (api) => {
      const [docs, leave] = await Promise.all([api.get('/modules/hr/me/documents'), api.get('/modules/hr/me/leave')])
      return { docs, hasCard: Boolean(leave.person) }
    }),
    visible: (me, data) => Boolean(data?.hasCard),
    Component: lazy(() => import('./hr/leave/MyDocumentsSection.jsx')),
  },
  {
    // только редактор новостей (ответственный за news или администратор)
    id: 'news',
    label: newsStrings.profile.title,
    visible: (me) => isNewsEditor(me),
    Component: lazy(() => import('./news/NewsAdminSection.jsx')),
  },
]

// Блоки главной страницы (/). Ядро само ничего не знает про модули: место и порядок = как здесь.
//   id        — ключ блока;
//   slot      — место (необязательно): 'banner' — над шапкой; 'left' и 'center' — левая и центральная колонки под шапкой
//               (новости и события; без них главная — одна колонка виджетов); не указано — столбиком с часами, погодой и курсами;
//   visible   — (me) => показывать ли блок (скрытый не рендерится и не делает запросов);
//   Component — получает { me }; сам грузит свои данные.
// Данные людей (дни рождения, отпуска) видят только уровни view/run; наблюдатель (structure) — нет.
export const HOME_WIDGETS = [
  { id: 'birthdays', visible: (me) => canSeeData(me.module_access.team), Component: lazy(() => import('./team/components/HomeBirthdays.jsx')) },
  { id: 'leave', visible: (me) => canSeeData(me.module_access.team), Component: lazy(() => import('./team/components/HomeLeave.jsx')) },
  { id: 'news-banner', slot: 'banner', visible: canReadNews, Component: lazy(() => import('./news/components/HomeBanner.jsx')) },
  { id: 'news-feed', slot: 'left', visible: canReadNews, Component: lazy(() => import('./news/components/HomeNewsFeed.jsx')) },
  { id: 'news-events', slot: 'center', visible: canReadNews, Component: lazy(() => import('./news/components/HomeEvents.jsx')) },
]
