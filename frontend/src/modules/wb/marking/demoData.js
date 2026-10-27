// Демо-данные раздела «Маркировка» в форме будущего ответа GET /modules/wb/marking?from=<дата>&to=<дата>.
// Источники (схема public, только чтение): api_wb_FinanceReport (продажи/возвраты с kiz),
// api_wb_Orders_FBS (сборочные задания, связь по srid = rid), api_wb_ExciseReport (excise-report).
// Значения выдуманы: реальные данные в репозиторий и в демо не попадают.
// TODO(Q6): заменить на запрос к бэкенду; правила «странных КМ» — по запросу, которым сверяли через ИИ.

function rng(seed) {
  let x = seed
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296
    return x / 4294967296
  }
}

const ARTICLES = [
  { nm_id: 1245450441, sa_name: '1170067010', title: 'Футболка базовая', price: 797 },
  { nm_id: 1245450504, sa_name: '0818600001', title: 'Носки, 3 пары', price: 911 },
  { nm_id: 1245450339, sa_name: '1249583002', title: 'Майка хлопок', price: 369 },
  { nm_id: 1245450485, sa_name: '1228544001', title: 'Лонгслив', price: 629 },
  { nm_id: 1286931807, sa_name: '0616763001', title: 'Худи оверсайз', price: 2407 },
  { nm_id: 1281572832, sa_name: '0836095004', title: 'Джинсы прямые', price: 2441 },
]
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz0123456789'
const STRANGE = ['notInFbs', 'soldTwice', 'returnWithoutSale', 'notInExcise']

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Последний день с данными (вчера) и период по умолчанию — прошлая неделя Пн–Сб.
export const LAST_DATE = '2026-10-26'
export const DEFAULT_PERIOD = { from: '2026-10-19', to: '2026-10-24' }
// Оформлено вплоть до этой даты; позже — частично (как будто документы ещё вносят)
const DONE_BEFORE = '2026-10-19'

// Строки одного дня: генератор зависит только от даты, поэтому день одинаков в любом выбранном периоде.
function demoDay(date) {
  const rand = rng(Number(date.replaceAll('-', '')))
  const pick = (arr) => arr[Math.floor(rand() * arr.length)]
  const code = (a) => `010461050${String(a.nm_id).slice(-5)}21${Array.from({ length: 13 }, () => pick(CHARS)).join('')}`
  const srid = () => `e${pick(CHARS)}.i${Array.from({ length: 32 }, () => pick('0123456789abcdef')).join('')}.0.0`
  const day = new Date(`${date}T00:00:00`)
  // в воскресенье продаж FBS меньше
  const sales = day.getDay() === 0 ? 4 + Math.floor(rand() * 6) : 18 + Math.floor(rand() * 20)
  const items = []
  for (let i = 0; i < sales; i++) {
    const a = pick(ARTICLES)
    const r = rand()
    const list = r < 0.84 ? 'withdraw' : r < 0.95 ? 'return' : 'strange'
    const done = date < DONE_BEFORE || rand() < 0.35
    items.push({
      key: `${date}-${i}`,
      list,
      km: code(a),
      nm_id: a.nm_id,
      sa_name: a.sa_name,
      title: a.title,
      date,
      price: a.price + Math.floor(rand() * 5) * 10,
      assembly_id: list === 'strange' && rand() < 0.5 ? null : 6132000000 + Math.floor(rand() * 900000),
      srid: srid(),
      reason: list === 'strange' ? pick(STRANGE) : null,
      document: list !== 'strange' && done ? `${(i % 40) + 1}/${day.getDate()}-${String(day.getMonth() + 1).padStart(2, '0')}-26` : '',
    })
  }
  return items
}

// Все дни периода [from, to] включительно, даты 'YYYY-MM-DD'.
export function periodDays(from, to) {
  const days = []
  for (const d = new Date(`${from}T00:00:00`); iso(d) <= to; d.setDate(d.getDate() + 1)) days.push(iso(d))
  return days
}

export function demoPeriod(from, to) {
  return {
    from,
    to,
    sources: {
      fbs: { table: 'api_wb_Orders_FBS', updatedAt: '2026-10-27T00:02:00' },
      finance: { table: 'api_wb_FinanceReport', updatedAt: '2026-10-27T03:10:00' },
      excise: { table: 'api_wb_ExciseReport', updatedAt: null },
    },
    items: periodDays(from, to).flatMap(demoDay),
  }
}
