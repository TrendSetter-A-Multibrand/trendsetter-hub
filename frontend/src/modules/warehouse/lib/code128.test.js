import test from 'node:test'
import assert from 'node:assert/strict'
import { c128codes, c128svg } from './code128.js'

test('Code128: старт B, символ, контрольная сумма, стоп', () => {
  assert.deepEqual(c128codes('A'), [104, 33, 34, 106])
})

test('Code128: чётное число цифр кодируется набором C', () => {
  const c = c128codes('1234')
  assert.equal(c[0], 105)
  assert.deepEqual(c.slice(1, 3), [12, 34])
  assert.equal(c.at(-1), 106)
})

test('Code128: svg строится для ШК короба', () => {
  assert.match(c128svg('S01_K01_P1_0014', 8), /^<svg /)
})

test('Code128: недопустимый символ', () => {
  assert.throws(() => c128codes('Ж'), /Недопустимый/)
})
