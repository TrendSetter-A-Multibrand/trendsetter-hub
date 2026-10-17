import test from 'node:test'
import assert from 'node:assert/strict'
import { backend, resetLocalBackend, DEMO_PIN, CAP } from './localBackend.js'

test.beforeEach(() => resetLocalBackend())

test('номера коробов идут по счётчику категории', () => {
  assert.equal(backend.nextBoxCode('5'), '05_0001')
  assert.equal(backend.nextBoxCode('5'), '05_0002')
  assert.equal(backend.nextBoxCode('12'), '12_0001')
})

test('палеты: вместимость 16/16/16/12/12/12, затем SECTOR_FULL', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(CAP), [16, 16, 16, 12, 12, 12])
  const pallets = []
  for (let i = 1; i <= 84; i++) {
    const code = backend.nextBoxCode('5')
    pallets.push(backend.assignPallet({ box: code, cat: '5', count: 10, receipt: 'T' }).pallet)
  }
  assert.equal(pallets.filter((p) => p === 1).length, 16)
  assert.equal(pallets.filter((p) => p === 4).length, 12)
  assert.equal(pallets.filter((p) => p === 6).length, 12)
  assert.throws(() => backend.assignPallet({ box: '05_0085', cat: '5', count: 1, receipt: 'T' }), /SECTOR_FULL:5/)
})

test('итоговый номер короба и повторное назначение того же короба', () => {
  const a = backend.assignPallet({ box: '05_0014', cat: '5', count: 3, receipt: 'T' })
  assert.equal(a.box, 'S05_K05_P1_0014')
  assert.equal(a.code, 'S05_P1')
  const again = backend.assignPallet({ box: 'S05_K05_P1_0014', cat: '5', count: 3, receipt: 'T' })
  assert.equal(again.code, 'S05_P1')
  assert.equal(backend.storageList().length, 1)
})

test('дополнительная секция: по ПИН, после заполнения основной', () => {
  assert.throws(() => backend.addSector('5', '6', '0000', []), /Неверный ПИН/)
  for (let i = 1; i <= 84; i++) backend.assignPallet({ box: `05_${String(i).padStart(4, '0')}`, cat: '5', count: 1, receipt: 'T' })
  backend.addSector('5', '6', DEMO_PIN, ['5'])
  const r = backend.assignPallet({ box: '05_0085', cat: '5', count: 1, receipt: 'T' })
  assert.equal(r.sector, '06')
  assert.throws(() => backend.addSector('7', '6', DEMO_PIN, []), /уже отдана/)
})

test('код ЧЗ принимается один раз на весь склад', () => {
  const m = { ki: '0104620270011115215Peib9SE3WkoI', pc: 'Иванов', box: '5', receipt: 'T' }
  assert.equal(backend.registerMark(m).status, 'ok')
  const dup = backend.registerMark(m)
  assert.equal(dup.status, 'dup')
  assert.equal(dup.pc, 'Иванов')
  backend.sync([{ op: 'undo', ref: 'x', ki: m.ki }])
  assert.equal(backend.registerMark(m).status, 'ok')
})

test('освобождение палета и повторное открытие короба', () => {
  const a = backend.assignPallet({ box: '05_0001', cat: '5', count: 4, receipt: 'T' })
  assert.equal(backend.boxInfo(a.box).count, 4)
  assert.equal(backend.reopenBox(a.box).storage.code, 'S05_P1')
  assert.equal(backend.freePallet('S05_P1').freed, 1)
  assert.equal(backend.storageList().length, 0)
})

test('приёмки: создание без учёта регистра и завершение', () => {
  assert.equal(backend.createReceipt('Поставка 1'), 'Поставка 1')
  assert.equal(backend.createReceipt('поставка 1'), 'Поставка 1')
  assert.equal(backend.listReceipts().length, 1)
  assert.equal(backend.finishReceipt('Поставка 1').length, 0)
})
