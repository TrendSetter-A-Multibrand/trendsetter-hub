import test from 'node:test'
import assert from 'node:assert/strict'

import { exportSheets, parseImport, shortCode } from './xlsx.js'
import strings from '../strings.js'

const KM = '0104610503161830215YOP8E/EBAQGD'

test('короткий код: без GS, без криптохвоста, без апострофа Excel', () => {
  assert.equal(shortCode(`${KM}\x1d91EE11\x1d92abc`), KM)
  assert.equal(shortCode(`${KM}91EE1192abcdefgh`), KM)
  assert.equal(shortCode(`'${KM}`), KM)
})

test('разбор: колонка «Документ», лист возврата, «Странные КМ» пропускаются', () => {
  const out = parseImport(
    [
      { name: 'Вывод из оборота', rows: [['Код', 'Артикул', 'Номер документа'], [KM, 123, '30/17-09-26'], ['', '', ''], ['итого', '', '']] },
      { name: 'Возврат в оборот', rows: [[KM, '5/18-09-26']] },
      { name: 'Странные КМ', rows: [[KM, '1/1-01-26']] },
    ],
    'withdraw',
  )
  assert.deepEqual(out.withdraw, [{ km: KM, document: '30/17-09-26' }])
  assert.deepEqual(out.return, [{ km: KM, document: '5/18-09-26' }])
  assert.equal(out.skipped, 1)
})

test('лист без «Возврат» в названии — в выбранный список; без номера — пустой документ', () => {
  const out = parseImport([{ name: 'Лист1', rows: [[KM]] }], 'return')
  assert.deepEqual(out.return, [{ km: KM, document: '' }])
})

test('выгрузка: три листа со статусами и причинами', () => {
  const item = { date: '2026-10-19', nm_id: 1, sa_name: 'a', title: 't', km: KM, assembly_id: 7, price: 10, srid: 's' }
  const sheets = exportSheets(
    [
      { ...item, list: 'withdraw', document: '' },
      { ...item, list: 'return', document: '2/1-10-26' },
      { ...item, list: 'strange', reason: 'soldTwice', document: '' },
    ],
    strings.marking,
  )
  assert.deepEqual(sheets.map((x) => x.name), ['Вывод из оборота', 'Возврат в оборот', 'Странные КМ'])
  assert.deepEqual(sheets[0].rows[1].slice(-2), ['', 'Ждёт вывода'])
  assert.deepEqual(sheets[1].rows[1].slice(-2), ['2/1-10-26', 'Возвращён'])
  assert.equal(sheets[2].rows[1].at(-1), strings.marking.reasons.soldTwice)
  assert.equal(sheets[0].rows[1][0], '19.10.2026')
})
