import test from 'node:test'
import assert from 'node:assert/strict'
import { rateRows } from './rates.js'

const data = {
  rates: [
    { code: 'USD', nominal: 1, value: 81.1234, previous: 80.9876, perUnit: 81.1234 },
    { code: 'EUR', nominal: 1, value: 94.5, previous: 94.5, perUnit: 94.5 },
    { code: 'AMD', nominal: 100, value: 22.3011, previous: 22.4519, perUnit: 0.223011 },
  ],
}

test('rateRows: номинал, формат, направление', () => {
  assert.deepEqual(rateRows(data), [
    { code: 'USD', label: '1 USD', value: '81,12 ₽', delta: '+0,14', direction: 'up' },
    { code: 'EUR', label: '1 EUR', value: '94,50 ₽', delta: '0,00', direction: 'flat' },
    { code: 'AMD', label: '100 AMD', value: '22,30 ₽', delta: '−0,15', direction: 'down' },
  ])
})

test('rateRows: порог flat 0.005', () => {
  const row = (value, previous) => rateRows({ rates: [{ code: 'USD', nominal: 1, value, previous }] })[0]
  assert.equal(row(10.004, 10).direction, 'flat')
  assert.equal(row(10.006, 10).direction, 'up')
  assert.equal(row(10, 10.006).direction, 'down')
})

test('rateRows: пусто и ошибка', () => {
  assert.deepEqual(rateRows(null), [])
  assert.deepEqual(rateRows({ rates: [] }), [])
})
