import test from 'node:test'
import assert from 'node:assert/strict'

import { chzSheet, exportSheets, importTemplate, parseImport, shortCode } from './xlsx.js'
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

test('список по заголовку колонки номера; номера вида back/31-08-26/О', () => {
  const out = parseImport([{ name: 'Лист1', rows: [['Код идентификации', 'Номер возврата из оборота'], [KM, 'back/31-08-26/О']] }], 'withdraw')
  assert.deepEqual(out.return, [{ km: KM, document: 'back/31-08-26/О' }])
  const out2 = parseImport([{ name: 'Лист1', rows: [['Код идентификации', 'Цена', 'Номер вывода из оборота'], [KM, '519', '42/25-10-26/И']] }], 'return')
  assert.deepEqual(out2.withdraw, [{ km: KM, document: '42/25-10-26/И' }])
})

test('файл для «Честного ЗНАКа»: как шаблоны отдела', () => {
  const items = [{ km: KM, price: 288.42 }]
  assert.deepEqual(chzSheet('withdraw', items).rows, [['Код идентификации', 'Цена за единицу товара с НДС'], [KM, 288.42]])
  assert.deepEqual(chzSheet('return', items).rows, [[KM]])
})

test('заполненный шаблон загрузки разбирается по листам', () => {
  const sheets = importTemplate()
  assert.equal(parseImport(sheets, 'withdraw').skipped, 0)
  sheets[0].rows.push([KM, 519, '42/25-10-26'])
  sheets[1].rows.push([KM, 'back/31-08-26'])
  const out = parseImport(sheets, 'withdraw')
  assert.deepEqual(out.withdraw, [{ km: KM, document: '42/25-10-26' }])
  assert.deepEqual(out.return, [{ km: KM, document: 'back/31-08-26' }])
})
