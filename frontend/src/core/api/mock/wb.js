// Mock модуля «Wildberries», раздел «Маркировка» (демо-режим): тот же контракт и права, что у бэкенда
// (backend/app/modules/wb: GET /modules/wb/marking?from&to, POST /modules/wb/marking/document).
// Колонки — как в api_wb_FinanceReport, api_wb_Orders_FBS и api_wb_ExciseReport; значения выдуманы, реальные данные в демо не попадают.
import { ApiError, defaultMessage } from '../client.js'
import { canRun, canSeeData } from '../../access.js'

const MIN_DATE = '2026-08-01'
const LISTS = ['withdraw', 'return']

function rng(seed) {
  let x = seed
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296
    return x / 4294967296
  }
}

const ARTICLES = [
  { nm_id: 1245450441, sa_name: '1170067010', title: 'Футболки', price: 797 },
  { nm_id: 1245450504, sa_name: '0818600001', title: 'Носки', price: 911 },
  { nm_id: 1245450339, sa_name: '1249583002', title: 'Майки', price: 369 },
  { nm_id: 1245450485, sa_name: '1228544001', title: 'Лонгсливы', price: 629 },
  { nm_id: 1286931807, sa_name: '0616763001', title: 'Худи', price: 2407 },
  { nm_id: 1281572832, sa_name: '0836095004', title: 'Джинсы', price: 2441 },
]
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz0123456789'
const STRANGE = ['soldTwice', 'notInExcise']

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const shift = (date, days) => {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + days)
  return iso(d)
}

function periodDays(from, to) {
  const days = []
  for (let d = from; d <= to; d = shift(d, 1)) days.push(d)
  return days
}

// Строки одного дня: генератор зависит только от даты, поэтому день одинаков в любом выбранном периоде.
// Документы по дням старше недели «уже внесены», по свежим — частично.
function demoDay(date, today) {
  const rand = rng(Number(date.replaceAll('-', '')))
  const pick = (arr) => arr[Math.floor(rand() * arr.length)]
  const day = new Date(`${date}T00:00:00`)
  const sales = day.getDay() === 0 ? 4 + Math.floor(rand() * 6) : 18 + Math.floor(rand() * 20)
  const items = []
  for (let i = 0; i < sales; i++) {
    const a = pick(ARTICLES)
    const r = rand()
    const list = r < 0.84 ? 'withdraw' : r < 0.95 ? 'return' : 'strange'
    const km = `010461050${String(a.nm_id).slice(-5)}21${Array.from({ length: 13 }, () => pick(CHARS)).join('')}`
    const srid = `e${pick(CHARS)}.i${Array.from({ length: 32 }, () => pick('0123456789abcdef')).join('')}.0.0`
    const done = date < shift(today, -7) || rand() < 0.35
    items.push({
      key: `${list === 'strange' ? 'withdraw' : list}:${srid}:${km}`,
      list,
      km,
      nm_id: a.nm_id,
      sa_name: a.sa_name,
      title: a.title,
      date,
      price: a.price + Math.floor(rand() * 5) * 10,
      assembly_id: 6132000000 + Math.floor(rand() * 900000),
      srid,
      reason: list === 'strange' ? pick(STRANGE) : null,
      document: list !== 'strange' && done ? `${(i % 40) + 1}/${day.getDate()}-${String(day.getMonth() + 1).padStart(2, '0')}-26` : '',
    })
  }
  return items
}

// deps: userFromToken(token); accessTo(user, moduleId); now — для тестов
export function createWbHandlers({ userFromToken, accessTo, now = () => new Date() }) {
  const documents = {} // введённые в демо номера документов: key -> document
  const imported = {} // загруженные из Excel: '<list>:<код>' -> document

  const today = () => iso(now())
  const requireAccess = (token, check) => {
    const user = userFromToken(token)
    if (!check(accessTo(user, 'wb'))) throw new ApiError(403, defaultMessage(403))
    return user
  }

  return {
    handlers: {
      'GET /modules/wb/marking': ({ query, token }) => {
        requireAccess(token, canSeeData)
        const { from, to } = query
        const valid = /^\d{4}-\d{2}-\d{2}$/
        if (!valid.test(from ?? '') || !valid.test(to ?? '') || from > to || from < MIN_DATE) throw new ApiError(422, defaultMessage(422))
        const yesterday = shift(today(), -1)
        const items = periodDays(from, to <= yesterday ? to : yesterday).flatMap((d) => demoDay(d, today()))
        return {
          from,
          to,
          sources: {
            fbs: { table: 'api_wb_Orders_FBS', lastDate: today() },
            finance: { table: 'api_wb_FinanceReport', lastDate: yesterday },
            excise: { table: 'api_wb_ExciseReport', lastDate: null },
          },
          items: items.map((it) => {
            if (it.list === 'strange') return it
            if (it.key in documents) return { ...it, document: documents[it.key] }
            const doc = imported[`${it.list}:${it.km}`]
            return doc ? { ...it, document: doc } : it
          }),
        }
      },
      'POST /modules/wb/marking/document': ({ body, token }) => {
        requireAccess(token, canRun)
        const key = String(body?.key ?? '')
        if (!LISTS.includes(key.split(':')[0])) throw new ApiError(422, defaultMessage(422))
        const document = String(body?.document ?? '').trim()
        documents[key] = document
        return { key, document }
      },
      'POST /modules/wb/marking/documents': ({ body, token }) => {
        requireAccess(token, canRun)
        const keys = [...new Set(Array.isArray(body?.keys) ? body.keys.map(String) : [])]
        if (keys.some((k) => !LISTS.includes(k.split(':')[0]))) throw new ApiError(422, defaultMessage(422))
        const document = String(body?.document ?? '').trim()
        for (const k of keys) documents[k] = document
        return { saved: keys.length, document }
      },
      'POST /modules/wb/marking/import': ({ body, token }) => {
        requireAccess(token, canRun)
        if (!LISTS.includes(body?.list) || !Array.isArray(body?.rows)) throw new ApiError(422, defaultMessage(422))
        let saved = 0
        let skipped = 0
        for (const { km, document } of body.rows) {
          const code = String(km ?? '').trim().split('\x1d')[0]
          const doc = String(document ?? '').trim()
          if (!code.startsWith('01') || code.length <= 18 || !doc) skipped += 1
          else {
            imported[`${body.list}:${code}`] = doc
            saved += 1
          }
        }
        return { saved, skipped }
      },
    },
  }
}
