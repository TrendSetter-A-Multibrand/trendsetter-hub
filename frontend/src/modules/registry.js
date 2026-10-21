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
  { id: 'hr', status: 'roadmap', strings: hrStrings, Component: null },
  // forAll: виден всем активным сотрудникам (просмотр), без привязки к отделу; анкета — в настройках профиля (позже)
  { id: 'team', status: 'roadmap', forAll: true, strings: teamStrings, Component: null },
]

export const getModule = (id) => MODULES.find((m) => m.id === id)
