import test from 'node:test'
import assert from 'node:assert/strict'
import { formatValue, splitValues, valuesOfPerson } from './values.js'

const fields = [
  { key: 'first_name', kind: 'text' },
  { key: 'email', kind: 'text' },
  { key: 'manager_claim', kind: 'text' },
  { key: 'hobbies', kind: 'chips' },
  { key: 'photo', kind: 'photo' },
]

test('splitValues: колонки наверх, остальное в values, manager_claim и photo пропускаются', () => {
  const body = splitValues(fields, { first_name: ' Ада ', email: 'a@x.ru', manager_claim: 'x', hobbies: ['чай'] })
  assert.deepEqual(body, { firstName: 'Ада', email: 'a@x.ru', values: { hobbies: ['чай'] } })
})

test('splitValues: пустые значения очищаются пустым значением типа', () => {
  assert.deepEqual(splitValues(fields, {}).values, { hobbies: [] })
})

test('valuesOfPerson и formatValue', () => {
  const v = valuesOfPerson(fields, { firstName: 'Ада', email: null, answers: { hobbies: ['а', 'б'] } })
  assert.deepEqual(v, { first_name: 'Ада', email: '', hobbies: ['а', 'б'] })
  assert.equal(formatValue(fields[3], v.hobbies), 'а, б')
  assert.equal(formatValue({ kind: 'links' }, [{ label: 'Сайт', url: 'https://e.com' }]), 'Сайт: https://e.com')
})
