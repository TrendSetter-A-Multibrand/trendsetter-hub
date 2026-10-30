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
import holidaysStrings from './holidays/strings.js'
import { canReadHolidays, isHolidaysEditor } from './holidays/lib/holidays.js'
import feedbackStrings from './feedback/strings.js'
import { canSendFeedback, isFeedbackReader } from './feedback/lib/feedback.js'

// «Запуск» на HR: вкладка «Сообщения» в «Персонале» доступна только при нём (HrPage пускает только run)
const hrRun = (me) => me.module_access?.hr === 'run'

// hidden: boolean или (me) => boolean (isModuleHidden в core/access.js). Скрытый модуль есть в реестре (особые права, группы, права в /core/me),
// но не показывается в меню, а его страница /modules/<id> — «Не найдено». Нужен модулям без своей страницы (pricing)
// и страницам только для части пользователей (обратная связь — только читателю; блоки новостей на главной и «Мои предложения» в профиле — всем читателям).
// redirect: строка или (me) => строка | null (resolveRedirect в core/access.js). Страница /modules/<id> сразу перенаправляет на этот адрес
// (до проверки hidden и доступа): старые ссылки и адреса из уведомлений.
export const MODULES = [
  { id: 'purchasing', status: 'roadmap', strings: purchasingStrings, Component: lazy(() => import('./purchasing/PurchasingPage.jsx')) },
  { id: 'warehouse', status: 'mvp', wide: true, strings: warehouseStrings, Component: lazy(() => import('./warehouse/WarehousePage.jsx')) },
  // sections: разделы модуля — всплывают в меню при наведении, ведут на /modules/<id>?section=<key>
  {
    id: 'wb', status: 'mvp', strings: wbStrings, Component: lazy(() => import('./wb/WbPage.jsx')),
    sections: Object.entries(wbStrings.sections).map(([key, v]) => ({ key, label: v.label })),
  },
  { id: 'analytics', status: 'roadmap', strings: analyticsStrings, Component: null },
  // Ценообразование — раздел модуля WB (решение 2026-10-28); модуль скрыт из меню, права и отдел остаются
  { id: 'pricing', status: 'roadmap', hidden: true, strings: pricingStrings, Component: null },
  // extraTabs: вкладки, которые другие модули добавляют в «Персонал» (HrPage сам ничего не импортирует из feedback):
  //   { key, group, groupLabel, label, visible(me), badge(me), Component } — вставляются перед группой «Безопасность»;
  // menuBadge(me): число у пункта меню вместо me.module_badges[id] (к HR добавляются новые сообщения, если читатель попадает в «Персонал»)
  {
    id: 'hr', status: 'mvp', wide: true, strings: hrStrings, Component: lazy(() => import('./hr/HrPage.jsx')),
    extraTabs: [
      {
        key: 'feedback', group: 'feedback', groupLabel: feedbackStrings.hr.group, label: feedbackStrings.hr.tab,
        visible: isFeedbackReader, badge: (me) => me.module_badges?.feedback ?? 0,
        Component: lazy(() => import('./feedback/FeedbackAdminSection.jsx')),
      },
    ],
    menuBadge: (me) => (me.module_badges?.hr ?? 0) + (isFeedbackReader(me) && hrRun(me) ? (me.module_badges?.feedback ?? 0) : 0),
  },
  // forAll: виден всем активным сотрудникам (просмотр), без привязки к отделу; анкета — в настройках профиля (позже)
  // calendar: производственный календарь, который «Карта команды» открывает в окне (team не импортирует holidays)
  {
    id: 'team', status: 'mvp', forAll: true, wide: true, strings: teamStrings, Component: lazy(() => import('./team/TeamPage.jsx')),
    calendar: { visible: canReadHolidays, label: holidaysStrings.title, Component: lazy(() => import('./holidays/components/CalendarModal.jsx')) },
  },
  // последней строкой: номера пунктов меню остальных модулей не сдвигаются
  // Редактор новостей и Производственный календарь теперь вкладки страницы «Администрация» (OFFICE_SECTIONS ниже, /office);
  // строки остаются в реестре для прав и групп (бэкенд проверяет id модулей), а старые адреса /modules/<id> ведут на вкладки.
  // TODO(Q-N4): опции view/run у «Новостей» в особых правах и группах ни на что не влияют (кроме viewer через Q-G1)
  {
    id: 'news', status: 'mvp', homeEditor: true, hidden: true, forAll: true, wide: true, strings: newsStrings,
    Component: null, redirect: '/office?tab=news',
  },
  {
    id: 'holidays', status: 'mvp', hidden: true, forAll: true, wide: true, strings: holidaysStrings,
    Component: null, redirect: '/office?tab=holidays',
  },
  // Обратная связь: основное место — вкладка «Сообщения» в «Персонале». Пункт меню остаётся читателю без «Запуска» на HR;
  // с «Запуском» /modules/feedback ведёт во вкладку (ссылки уведомлений). Отправка — кнопка в верхней строке и вкладка профиля.
  // TODO(Q-AP5): читатель обратной связи без доступа run к HR сохраняет старый пункт меню; иначе ему нужен доступ к HR
  {
    id: 'feedback', status: 'mvp', hidden: (me) => !isFeedbackReader(me) || hrRun(me), forAll: true, wide: true, strings: feedbackStrings,
    redirect: (me) => (isFeedbackReader(me) && hrRun(me) ? '/modules/hr?tab=feedback' : null),
    Component: lazy(() => import('./feedback/FeedbackAdminSection.jsx')),
  },
]

export const getModule = (id) => MODULES.find((m) => m.id === id)

// Форма анкеты для экрана онбординга (ядро не импортирует modules/team напрямую).
export const ONBOARDING_PROFILE_FORM = lazy(() => import('./team/components/MyProfileSection.jsx'))

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
    // свои предложения новостей: читатель news (viewer — нет)
    id: 'proposals',
    label: newsStrings.proposals.title,
    load: ownData((api) => api.get('/modules/news/proposals/mine')),
    visible: (me, data) => canReadNews(me) && data != null,
    badge: (data) => data.items.filter((i) => ['needs_changes', 'rejected'].includes(i.status)).length,
    Component: lazy(() => import('./news/MyProposalsSection.jsx')),
  },
  {
    // свои именные сообщения обратной связи: отправитель feedback (viewer — нет)
    id: 'feedback',
    label: feedbackStrings.profile.title,
    load: ownData((api) => api.get('/modules/feedback/mine')),
    visible: (me, data) => canSendFeedback(me) && data != null,
    Component: lazy(() => import('./feedback/MyFeedbackSection.jsx')),
  },
]

// homeEditor: «Ответственный» этого модуля может настраивать виджеты главной (зеркало home_editor в бэкенд-манифесте).

// Блоки главной страницы (/). Ядро само ничего не знает про модули: место и порядок = как здесь.
//   id        — ключ блока;
//   label     — подпись в настройке виджетов главной (у виджетов без slot; редактор новостей меняет их порядок и включение);
//   slot      — место (необязательно): 'banner' — над шапкой; 'left' и 'center' — левая и центральная колонки под шапкой
//               (новости и события; без них главная — одна колонка виджетов); не указано — столбиком с часами, погодой и курсами;
//   visible   — (me) => показывать ли блок (скрытый не рендерится и не делает запросов);
//   Component — получает { me }; сам грузит свои данные.
// Данные людей (дни рождения, отпуска) видят только уровни view/run; наблюдатель (structure) — нет.
export const HOME_WIDGETS = [
  { id: 'birthdays', label: teamStrings.birthdays.title, visible: (me) => canSeeData(me.module_access.team), Component: lazy(() => import('./team/components/HomeBirthdays.jsx')) },
  { id: 'leave', label: teamStrings.home.widgetLabel, visible: (me) => canSeeData(me.module_access.team), Component: lazy(() => import('./team/components/HomeLeave.jsx')) },
  { id: 'holidays', label: holidaysStrings.home.widgetLabel, visible: canReadHolidays, Component: lazy(() => import('./holidays/components/HomeHolidays.jsx')) },
  { id: 'news-banner', slot: 'banner', visible: canReadNews, Component: lazy(() => import('./news/components/HomeBanner.jsx')) },
  { id: 'news-feed', slot: 'left', visible: canReadNews, Component: lazy(() => import('./news/components/HomeNewsFeed.jsx')) },
  { id: 'news-events', slot: 'center', visible: canReadNews, Component: lazy(() => import('./news/components/HomeEvents.jsx')) },
]

// Кнопки верхней строки (правее переключателя темы). Ядро само ничего не знает про модули: порядок = как здесь.
//   id        — ключ кнопки;
//   visible   — (me) => показывать ли кнопку;
//   Component — получает { me }; сам открывает своё окно.
export const TOPLINE_ACTIONS = [
  { id: 'feedback', visible: canSendFeedback, Component: lazy(() => import('./feedback/components/FeedbackButton.jsx')) },
]

// Вкладки страницы «Администрация» (/office, страница ядра, не модуль). Ядро само ничего не знает про модули: порядок вкладок = порядок здесь.
//   id        — значение ?tab= в адресе;
//   label     — подпись вкладки;
//   visible   — (me) => показывать ли вкладку (нет видимых вкладок — нет и пункта меню, страница — «Не найдено»);
//   badge     — (me) => число рядом с вкладкой и в сумме у пункта меню (необязательно);
//   Component — получает { me }; сам рисует содержимое вкладки (без PageHead).
export const OFFICE_SECTIONS = [
  {
    id: 'news', label: newsStrings.office.tab, visible: isNewsEditor, badge: (me) => me.module_badges?.news ?? 0,
    Component: lazy(() => import('./news/NewsAdminSection.jsx')),
  },
  { id: 'holidays', label: holidaysStrings.tool, visible: isHolidaysEditor, Component: lazy(() => import('./holidays/HolidaysAdminSection.jsx')) },
]
