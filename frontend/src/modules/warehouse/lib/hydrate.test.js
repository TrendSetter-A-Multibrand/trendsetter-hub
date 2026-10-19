import test from 'node:test'
import assert from 'node:assert/strict'
import { fromRow, nKey, merge } from './hydrate.js'
import { allLines, kizLines, diffCsv, byBoxCsv } from './csv.js'
import { route } from './plan.js'

const KI1 = '0104620270011115215Peib9SE3WkoI'
const KI2 = '0104620270011115216Qwert12345Zz'
const EAN = '4620270011115'

const row = (id, t, box, boxCode, barcode, status = 'ok', extra = {}) =>
  [id, t, 'Иванов', box, boxCode, barcode, status, Boolean(extra.noCz), extra.ki || '', extra.full || '']
const loc = (id, t, box, boxCode, bc, status = 'ok', extra = {}) => ({ id, t, worker: 'Иванов', box, boxCode, bc, status, noCz: false, ...extra })
const emptySt = (receipt = 'П1') => ({ boxes: {}, scans: [], closed: [], alloc: {}, fact: {}, pend: {}, receipt })
const snap = (scans, closed = [], receipt = 'П1') => ({ receipt, scans: scans.map(fromRow), closed })
const closedRec = (code, box, closedAt, extra = {}) => ({ code, box, count: 1, worker: 'Иванов', opened: 1, closedAt, pallet: 'S05_P1', storage: null, ...extra })
const plan0 = { kiCount: 0, map: {}, hasQty: false }

test('fromRow: обычный скан, скан ЧЗ и скан «без ЧЗ»', () => {
  assert.deepEqual(fromRow(row('a', 5, '5', '05_0001', '123')), { id: 'a', t: 5, worker: 'Иванов', box: '5', boxCode: '05_0001', bc: '123', status: 'ok', noCz: false })
  assert.deepEqual(fromRow(row('b', 6, '5', '05_0001', EAN, 'ok', { ki: KI1, full: KI1 + '91EE' })), {
    id: 'b', t: 6, worker: 'Иванов', box: '5', boxCode: '05_0001', bc: KI1, ki: KI1, ean: EAN, gtin: '04620270011115', status: 'ok', noCz: false, full: KI1 + '91EE',
  })
  assert.equal('full' in fromRow(row('c', 6, '5', 'x', EAN, 'ok', { ki: KI1 })), false)
  assert.equal(fromRow(row('d', 7, '5', '05_0001', EAN, 'ok', { noCz: true })).noCz, true)
})

test('nKey: четыре случая', () => {
  const plain = { bc: '00123' }
  const cz = { bc: KI1, ki: KI1 }
  assert.equal(nKey(plain, { kiCount: 0 }), '123')
  assert.equal(nKey({ bc: '00123', noCz: true }, { kiCount: 5 }), '123')
  assert.equal(nKey(cz, { kiCount: 3 }), KI1)
  assert.equal(nKey(cz, { kiCount: 0 }), '4620270011115')
  assert.equal(nKey(cz, null), '4620270011115')
  assert.equal(nKey({ ...plain, n: 'zzz' }, null), '123') // сохранённое n не используется
})

test('правило 1: другая приёмка или нет снимка — только st', () => {
  const st = { ...emptySt('П1'), scans: [loc('a', 1, '5', '05_0001', '1')], closed: [closedRec('S05_K05_P1_0001', '5', 9)] }
  const db = snap([row('z', 1, '5', '05_0009', '9')], [closedRec('S05_K05_P1_0009', '5', 8)], 'Другая')
  for (const d of [db, null]) {
    const v = merge(d, st, { plan: plan0 })
    assert.deepEqual(v.scans.map((s) => s.id), ['a'])
    assert.deepEqual(v.closed.map((c) => c.code), ['S05_K05_P1_0001'])
    assert.deepEqual(v.fact, { 5: 1 })
    assert.deepEqual(v.alloc, { 1: { 5: 1 } })
    assert.deepEqual(v.closedElsewhere, [])
  }
  assert.equal(merge(snap([], [], 'п1'), emptySt('П1'), {}).receipt, 'П1') // регистр названия не важен
})

test('правило 2: закрытые короба — снимок, локальные, без переоткрытых, по closedAt убыв.', () => {
  const st = { ...emptySt(), closed: [closedRec('S05_K05_P1_0003', '5', 30), closedRec('S05_K05_P1_0001', '5', 10, { pallet: 'local' })] }
  const db = snap([], [closedRec('S05_K05_P1_0001', '5', 10), closedRec('S05_K05_P1_0002', '5', 20), closedRec('S05_K05_P1_0004', '5', 5)])
  const v = merge(db, st, { reopened: new Set(['S05_K05_P1_0004']) })
  assert.deepEqual(v.closed.map((c) => c.code), ['S05_K05_P1_0003', 'S05_K05_P1_0002', 'S05_K05_P1_0001'])
  assert.equal(v.closed[2].pallet, 'S05_P1') // версия из снимка
})

test('правило 3: сканы — дедупликация по id, локальная версия, добавление, сортировка', () => {
  const st = { ...emptySt(), scans: [loc('b', 2, '5', 'S05_K05_P1_0001', '2'), loc('c', 3, '5', null, '3')] }
  const db = snap([row('b', 2, '5', '05_0001', '2'), row('a', 1, '5', '05_0001', '1')])
  const v = merge(db, st, { plan: plan0 })
  assert.deepEqual(v.scans.map((s) => s.id), ['a', 'b', 'c'])
  assert.equal(v.scans[1].boxCode, 'S05_K05_P1_0001') // локальная версия
  assert.equal(v.scans[2].boxCode, null) // ждёт номер короба (pend)
  assert.deepEqual(v.fact, { 5: 3 })
  assert.deepEqual(merge(db, st, { plan: plan0 }), v) // повтор даёт то же
})

test('при равном времени порядок по id', () => {
  const v = merge(snap([row('b', 1, '5', 'x', '1'), row('a', 1, '5', 'x', '2')]), emptySt(), {})
  assert.deepEqual(v.scans.map((s) => s.id), ['a', 'b'])
})

test('undone убирает скан снимка', () => {
  const db = snap([row('a', 1, '5', 'x', '1'), row('b', 2, '5', 'x', '2')])
  const v = merge(db, emptySt(), { undone: new Set(['a']) })
  assert.deepEqual(v.scans.map((s) => s.id), ['b'])
})

test('временный код + закрытый короб с тем же boxId: код заменяется (неотправленный close тоже)', () => {
  const X = 'S05_K05_P1_0014'
  const db = snap([row('a', 1, '5', '05_0014', '1'), row('b', 2, '6', '06_0014', '2')], [closedRec(X, '5', 9)])
  const v = merge(db, emptySt(), {})
  assert.deepEqual(v.scans.map((s) => s.boxCode), [X, '06_0014'])
  // close ещё не дошёл до базы: короб только в st.closed, сканы в базе со временным кодом
  const st = { ...emptySt(), closed: [closedRec(X, '5', 9)] }
  const v2 = merge(snap([row('a', 1, '5', '05_0014', '1')]), st, {})
  assert.equal(v2.scans[0].boxCode, X)
  assert.deepEqual(v2.closed.map((c) => c.code), [X])
})

test('локальный скан, найденный и в снимке, тоже получает итоговый код закрытого короба', () => {
  const X = 'S05_K05_P1_0014'
  const st = { ...emptySt(), scans: [loc('a', 1, '5', '05_0014', '1'), loc('b', 2, '5', '05_0014', '2')] }
  const db = snap([row('a', 1, '5', '05_0014', '1')], [closedRec(X, '5', 9)])
  const v = merge(db, st, {})
  assert.deepEqual(v.scans.map((s) => s.boxCode), [X, X])
  assert.equal(st.scans[0].boxCode, '05_0014') // вход не изменён
})

test('reopened убирает короб снимка', () => {
  const X = 'S05_K05_P1_0014'
  const db = snap([row('a', 1, '5', X, '1')], [closedRec(X, '5', 9)])
  const v = merge(db, emptySt(), { reopened: new Set([X]) })
  assert.equal(v.closed.length, 0)
  assert.equal(v.scans[0].boxCode, X)
  assert.deepEqual(v.closedElsewhere, [])
})

test('fact и alloc: alloc только по ok, ключи по раскладке', () => {
  const db = snap([
    row('a', 1, '5', 'x', '00123'),
    row('b', 2, '5', 'x', '00123'),
    row('c', 3, '20', 'y', '00123', 'extra'),
    row('d', 4, '5', 'x', EAN, 'ok', { ki: KI1 }),
    row('e', 5, '6', 'z', '777', 'ok', { noCz: true }),
  ])
  const v = merge(db, emptySt(), { plan: { kiCount: 0 } })
  assert.deepEqual(v.fact, { 5: 3, 20: 1, 6: 1 })
  assert.deepEqual(v.alloc, { 123: { 5: 2 }, 4620270011115: { 5: 1 }, 777: { 6: 1 } })
  assert.deepEqual(merge(db, emptySt(), { plan: { kiCount: 2 } }).alloc[KI1], { 5: 1 })
})

test('правило 6: closedElsewhere', () => {
  const X = 'S05_K05_P1_0014'
  const db = snap([], [closedRec(X, '5', 9)])
  const cell = (code) => ({ box: { code, opened: 1 }, items: [] })
  const st = { ...emptySt(), boxes: { 5: cell('05_0014'), 6: cell('06_0001') } }
  assert.deepEqual(merge(db, st, {}).closedElsewhere, ['05_0014'])
  assert.deepEqual(merge(db, { ...st, closed: [closedRec(X, '5', 9)] }, {}).closedElsewhere, [])
  assert.deepEqual(merge(db, st, { queue: [{ op: 'close', boxCode: X, tmp: '05_0014' }] }).closedElsewhere, [])
  assert.deepEqual(merge(db, st, { queue: [{ op: 'scan', boxCode: '05_0014' }] }).closedElsewhere, ['05_0014'])
})

test('правило 7: merge не меняет входные данные', () => {
  const st = { ...emptySt(), scans: [loc('c', 3, '5', null, '3')], closed: [closedRec('S05_K05_P1_0002', '5', 3)], boxes: { 5: { box: { code: '05_0001' }, items: [] } } }
  const db = snap([row('a', 1, '5', '05_0001', '1')], [closedRec('S05_K05_P1_0001', '5', 5)])
  const opts = { plan: plan0, undone: new Set(['q']), reopened: new Set(['r']), queue: [{ op: 'undo', ref: 'q' }] }
  const dump = () => JSON.stringify([db, st, [...opts.undone], [...opts.reopened], opts.queue])
  const before = dump()
  merge(db, st, opts)
  assert.equal(dump(), before)
})

test('выгрузки: снимок равен локальному состоянию — тот же текст, что из st', () => {
  const full = KI1 + '91EE10'
  const plan = {
    kiCount: 2,
    kiMap: { [KI1]: '5', [KI2]: '5' },
    map: { 4620270011115: [{ box: '5', qty: 2, raw: EAN }] },
    hasQty: true,
    kiEan: {},
    gtinMarked: {},
  }
  const mk = (id, t, box, bc, status, extra = {}) => loc(id, t, box, '05_0001', bc, status, extra)
  const scans = [
    mk('w1', 1000, '5', KI1, 'ok', { ki: KI1, ean: EAN, gtin: '04620270011115', full }),
    mk('w2', 2000, '5', '4600000000011', 'ok', { noCz: true }),
    mk('w3', 3000, '20', '999', 'unknown'),
    mk('w4', 4000, '20', '4600000000011', 'extra', { noCz: true }),
    mk('w5', 5000, '20', KI2, 'foreign', { ki: KI2, ean: EAN, gtin: '04620270011115' }),
  ]
  const alloc = {}
  for (const s of scans)
    if (s.status === 'ok') {
      const n = s.ki ? s.ki : s.bc.replace(/^0+/, '')
      alloc[n] = alloc[n] || {}
      alloc[n][s.box] = (alloc[n][s.box] || 0) + 1
    }
  const st = { ...emptySt(), scans, alloc }
  const db = snap(scans.map((s) => row(s.id, s.t, s.box, s.boxCode, s.ean || s.bc, s.status, { ki: s.ki, full: s.full, noCz: s.noCz })))
  const v = merge(db, st, { plan })
  assert.equal(allLines(v), allLines(st))
  assert.equal(kizLines(v), kizLines(st))
  assert.equal(diffCsv(v, plan), diffCsv(st, plan))
  const pm = { map: {}, ok: true }
  assert.equal(byBoxCsv(v, { worker: '' }, pm), byBoxCsv(st, { worker: '' }, pm))
})

test('маршрутизация: квота, выбранная сканами снимка, ведёт в 20 как излишек', () => {
  const plan = { kiCount: 0, hasQty: true, map: { 123: [{ box: '5', qty: 2, raw: '123' }] } }
  const db = snap([row('a', 1, '5', '05_0001', '123'), row('b', 2, '5', '05_0001', '00123')])
  const v = merge(db, emptySt(), { plan })
  assert.deepEqual(route(plan, v.alloc, '123'), { box: '20', status: 'extra' })
  assert.deepEqual(route(plan, emptySt().alloc, '123'), { box: '5', status: 'ok' })
})
