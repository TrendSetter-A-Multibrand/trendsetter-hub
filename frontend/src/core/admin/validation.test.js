import test from 'node:test'
import assert from 'node:assert/strict'
import strings from '../strings.js'
import { validateDepartmentName, validateDepartmentCode, validateUserForm } from './validation.js'

const v = strings.admin.validation
const departments = [
  { id: 1, code: 'purchasing', name: 'Закупки' },
  { id: 2, code: 'wb', name: 'WB-отдел' },
]
const users = [{ id: 1, email: 'Karen@example.com', full_name: 'Карен В.' }]

test('имя отдела: пустое и пробельное', () => {
  assert.equal(validateDepartmentName('', departments), v.nameEmpty)
  assert.equal(validateDepartmentName('   ', departments), v.nameEmpty)
})

test('имя отдела: слишком длинное', () => {
  assert.equal(validateDepartmentName('а'.repeat(65), departments), v.nameTooLong)
})

test('имя отдела: дубликат «закупки» vs «Закупки»', () => {
  assert.equal(validateDepartmentName('закупки', departments), v.nameDuplicate)
})

test('имя отдела: переименование в своё имя допустимо', () => {
  assert.equal(validateDepartmentName('Закупки', departments, 1), null)
  assert.equal(validateDepartmentName('Логистика', departments), null)
})

test('код отдела: кириллица, заглавная, дубликат, валидный', () => {
  assert.equal(validateDepartmentCode('Логистика', departments), v.codeInvalid)
  assert.equal(validateDepartmentCode('Logistics', departments), v.codeInvalid)
  assert.equal(validateDepartmentCode('purchasing', departments), v.codeDuplicate)
  assert.equal(validateDepartmentCode('logistics', departments), null)
})

test('пользователь: невалидный email, дубликат, пустое ФИО, валидный', () => {
  const ok = { email: 'new@example.com', full_name: 'Новый', access_level: 'employee', password: 'Pass-12345' }
  assert.equal(validateUserForm({ ...ok, email: 'не-почта' }, users), v.emailInvalid)
  assert.equal(validateUserForm({ ...ok, email: 'karen@EXAMPLE.com' }, users), v.emailDuplicate)
  assert.equal(validateUserForm({ ...ok, full_name: '  ' }, users), v.fullNameEmpty)
  assert.equal(validateUserForm({ ...ok, password: 'short' }, users), v.passwordInvalid)
  assert.equal(validateUserForm({ ...ok, password: 'ы'.repeat(40) }, users), v.passwordInvalid)
  assert.equal(validateUserForm(ok, users), null)
})
