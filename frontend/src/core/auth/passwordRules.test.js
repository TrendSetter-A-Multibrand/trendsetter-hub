import test from 'node:test'
import assert from 'node:assert/strict'
import strings from '../strings.js'
import { validateNewPassword, validatePasswordForm } from './passwordRules.js'

const p = strings.profile.settings.password

test('длина считается по символам Unicode, а не по байтам', () => {
  assert.equal(validateNewPassword('a', 'парольпарол'), null) // 11 символов
  assert.equal(validateNewPassword('a', 'парольпаро'), null) // ровно 10
  assert.equal(validateNewPassword('a', 'парольпар'), p.tooShort)
  assert.equal(validateNewPassword('a', '😀'.repeat(10)), null)
  assert.equal(validateNewPassword('a', 'x'.repeat(129)), p.tooLong)
  assert.equal(validateNewPassword('a', 'x'.repeat(128)), null)
})

test('новый пароль не совпадает со старым', () => {
  assert.equal(validateNewPassword('0123456789', '0123456789'), p.sameAsOld)
})

test('форма: старый обязателен, повтор должен совпасть', () => {
  assert.equal(validatePasswordForm({ oldPassword: '', newPassword: 'x'.repeat(10), repeat: 'x'.repeat(10) }), p.oldRequired)
  assert.equal(validatePasswordForm({ oldPassword: 'demo', newPassword: 'short', repeat: 'short' }), p.tooShort)
  assert.equal(validatePasswordForm({ oldPassword: 'demo', newPassword: 'x'.repeat(10), repeat: 'y'.repeat(10) }), p.mismatch)
  assert.equal(validatePasswordForm({ oldPassword: 'demo', newPassword: 'x'.repeat(10), repeat: 'x'.repeat(10) }), null)
})
