// Excel раздела «Маркировка»: разбор загруженного файла с уже выведенными кодами и листы выгрузки сверки.
// Чистые функции над строками листов (массивы ячеек) — без библиотеки xlsx, её подключает страница.

const CODE_RE = /^01\d{14}21\S{5,}/
const DOC_RE = /^[\p{L}\d]+\s*\/\s*\d{1,2}-\d{2}-\d{2,4}(\/\S+)?$/u // «42/25-10-26», «42/25-10-26/О», «back/31-08-26»
const GS = '\x1d'

// Короткий код, как в отчётах WB: до разделителя GS. Код из Excel часто без GS — тогда отрезаем криптохвост «91…92…»
// после 31 символа (01 + GTIN 14 + 21 + серийный номер 13, как у одежды).
export function shortCode(value) {
  const code = String(value ?? '').trim().replace(/^'/, '').split(GS)[0]
  return code.length > 31 && code.slice(31, 33) === '91' ? code.slice(0, 31) : code
}

const listOfSheet = (name, fallback) => (/стран/i.test(name) ? null : /возврат/i.test(name) ? 'return' : fallback)

// sheets: [{ name, rows: [[ячейка, …], …] }] -> { withdraw: [{ km, document }], return: [...], skipped }
// Код — первая ячейка строки, похожая на код маркировки. Номер документа — колонка с заголовком «Документ»/«Номер»,
// иначе ячейка вида «30/17-09-26». Листы «Странные КМ» пропускаются. Список — по названию листа («Возврат…») или заголовку колонки
// номера («Номер возврата из оборота» / «Номер вывода из оборота»), иначе выбранный в окне.
export function parseImport(sheets, fallbackList) {
  const out = { withdraw: [], return: [], skipped: 0 }
  for (const { name, rows } of sheets) {
    let list = listOfSheet(name, fallbackList)
    if (!list) continue
    let docCol = -1
    for (const row of rows) {
      const cells = row.map((c) => String(c ?? '').trim())
      const codeAt = cells.findIndex((c) => CODE_RE.test(shortCode(c)))
      if (codeAt < 0) {
        const header = cells.findIndex((c) => /документ|номер/i.test(c))
        if (header >= 0) {
          docCol = header
          if (/возврат/i.test(cells[header])) list = 'return'
          else if (/вывод/i.test(cells[header])) list = 'withdraw'
        }
        else if (cells.some(Boolean)) out.skipped += 1
        continue
      }
      const document = docCol >= 0 && docCol !== codeAt && cells[docCol] ? cells[docCol] : (cells.find((c) => DOC_RE.test(c)) ?? '')
      out[list].push({ km: shortCode(cells[codeAt]), document })
    }
  }
  return out
}

const LIST_COLUMNS = ['Дата', 'Артикул WB', 'Артикул продавца', 'Предмет', 'Код маркировки', 'Задание FBS', 'Цена продажи', 'srid']
const ddmmyyyy = (iso) => iso.split('-').reverse().join('.')
const base = (it) => [ddmmyyyy(it.date), it.nm_id, it.sa_name, it.title, it.km, it.assembly_id ?? '', it.price, it.srid]

// Листы выгрузки, как в прежней сводной таблице: [{ name, rows }]
export function exportSheets(items, s) {
  const of = (list) => items.filter((it) => it.list === list)
  return [
    { name: s.lists.withdraw, rows: [[...LIST_COLUMNS, s.columns.document, s.columns.status], ...of('withdraw').map((it) => [...base(it), it.document, it.document ? s.statuses.withdraw.done : s.statuses.withdraw.wait])] },
    { name: s.lists.return, rows: [[...LIST_COLUMNS, s.columns.returnDocument, s.columns.status], ...of('return').map((it) => [...base(it), it.document, it.document ? s.statuses.return.done : s.statuses.return.wait])] },
    { name: s.lists.strange, rows: [[...LIST_COLUMNS, s.columns.reason], ...of('strange').map((it) => [...base(it), s.reasons[it.reason] ?? it.reason])] },
  ]
}

// Файл для загрузки в «Честный ЗНАК» — как шаблоны отдела: вывод — «Код идентификации» и «Цена за единицу товара с НДС»,
// возврат — только коды, без заголовка. Код — текстом, цена — числом, как в шаблонах.
export function chzSheet(list, items) {
  if (list === 'return') return { name: 'Шаблон', rows: items.map((it) => [it.km]) }
  return { name: 'Лист1', rows: [['Код идентификации', 'Цена за единицу товара с НДС'], ...items.map((it) => [it.km, it.price])] }
}

// Шаблон для загрузки уже выведенных/возвращённых кодов на сайт — как файлы отдела (вывод: код, цена, номер; возврат: код, номер):
// два листа, только заголовки (пример с выдуманным кодом
// при загрузке попал бы в базу). parseImport узнаёт список по названию листа и заголовку колонки номера.
export const IMPORT_TEMPLATE_NAME = 'Шаблон_выведенные_коды.xlsx'
export function importTemplate() {
  return [
    { name: 'Вывод из оборота', rows: [['Код идентификации', 'Цена за единицу товара с НДС', 'Номер вывода из оборота']] },
    { name: 'Возврат в оборот', rows: [['Код идентификации', 'Номер возврата из оборота']] },
  ]
}
