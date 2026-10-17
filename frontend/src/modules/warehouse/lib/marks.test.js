import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDM, isDM, fixLayout, kiOf, gtinEan } from './marks.js'

// Пример КИ из технического описания приложения
const KI = '0104620270011115215Peib9SE3WkoI'

test('parseDM: сырой код с криптохвостом без GS', () => {
  const p = parseDM(KI + '91EE10' + '92abcdefghijklmnopqrstuvwxyz')
  assert.equal(p.ki, KI)
  assert.equal(p.gtin, '04620270011115')
  assert.equal(p.serial, '5Peib9SE3WkoI')
})

test('parseDM: с разделителем GS', () => {
  const p = parseDM(KI + '\u001d91EE10\u001d92abcdef')
  assert.equal(p.ki, KI)
  assert.ok(p.full.includes('<GS>'))
})

test('parseDM: со скобками и с префиксом сканера', () => {
  assert.equal(parseDM('(01)04620270011115(21)5Peib9SE3WkoI(91)EE10(92)abc').ki, KI)
  assert.equal(parseDM(']d2' + KI + '91EE10').ki, KI)
})

test('isDM отличает код ЧЗ от обычного штрихкода', () => {
  assert.equal(isDM(KI + '91EE10'), true)
  assert.equal(isDM('4620270011115'), false)
})

test('fixLayout: код в русской раскладке переводится в латиницу', () => {
  assert.equal(fixLayout('ЙЦУ'), 'QWE')
  assert.equal(fixLayout('abc123'), 'abc123')
})

test('kiOf и gtinEan', () => {
  assert.equal(kiOf(KI + '91EE10'), KI)
  assert.equal(kiOf('4620270011115'), null)
  assert.equal(gtinEan('04620270011115'), '4620270011115')
  assert.equal(gtinEan('4620270011115'), '4620270011115')
})
