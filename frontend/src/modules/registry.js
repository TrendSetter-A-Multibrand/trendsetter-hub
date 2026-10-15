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

export const MODULES = [
  { id: 'purchasing', status: 'mvp', strings: purchasingStrings, Component: lazy(() => import('./purchasing/PurchasingPage.jsx')) },
  { id: 'wb', status: 'roadmap', strings: wbStrings, Component: null },
  { id: 'analytics', status: 'roadmap', strings: analyticsStrings, Component: null },
  { id: 'pricing', status: 'roadmap', strings: pricingStrings, Component: null },
]

export const getModule = (id) => MODULES.find((m) => m.id === id)
