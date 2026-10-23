import test from 'node:test'
import assert from 'node:assert/strict'
import { FILE_FIELDS, MONEY_FIELDS, buildDraft, buildPatch, parseRuDate, withBirthdayHidden } from './dossier.js'

test('parseRuDate: ДД.ММ.ГГГГ в ISO, мусор и несуществующие даты — null', () => {
  assert.equal(parseRuDate('05.03.2026'), '2026-03-05')
  assert.equal(parseRuDate(' 29.02.2024 '), '2024-02-29')
  assert.equal(parseRuDate('29.02.2026'), null)
  assert.equal(parseRuDate('2026-03-05'), null)
  assert.equal(parseRuDate('5.3.2026'), null)
  assert.equal(parseRuDate(''), null)
})

test('buildDraft: текст — строки, остальное null', () => {
  const draft = buildDraft(FILE_FIELDS, { legalName: 'Иванов', hiredAt: '2024-01-10' })
  assert.equal(draft.legalName, 'Иванов')
  assert.equal(draft.phone, '')
  assert.equal(draft.hiredAt, '2024-01-10')
  assert.equal(draft.country, null)
})

test('buildPatch: только изменённое, пустая строка -> null, без изменений -> пустой патч', () => {
  const source = { legalName: 'Иванов', phone: '+7', hiredAt: '2024-01-10', country: 'RU' }
  const draft = buildDraft(FILE_FIELDS, source)
  assert.deepEqual(buildPatch(FILE_FIELDS, draft, source), { patch: {}, invalid: [] })
  const next = { ...draft, phone: '  ', hiredAt: '2024-02-01', country: null, notes: ' заметка ' }
  assert.deepEqual(buildPatch(FILE_FIELDS, next, source).patch, { phone: null, hiredAt: '2024-02-01', country: null, notes: 'заметка' })
})

test('buildPatch: дата не по формату — в invalid и не в патче', () => {
  const draft = { ...buildDraft(FILE_FIELDS, {}), birthDate: '12.1' }
  assert.deepEqual(buildPatch(FILE_FIELDS, draft, {}), { patch: {}, invalid: ['birthDate'] })
})

test('buildPatch: числа денег', () => {
  const source = { salary: 100000, currency: 'RUB' }
  const draft = { ...buildDraft(MONEY_FIELDS, source), salary: 120000.5, payDay1: 5 }
  assert.deepEqual(buildPatch(MONEY_FIELDS, draft, source).patch, { salary: 120000.5, payDay1: 5 })
})

test('birthdayHidden: в patch только при изменении', () => {
  assert.deepEqual(withBirthdayHidden({}, false, { birthdayHidden: false }), {})
  assert.deepEqual(withBirthdayHidden({}, false, {}), {}, 'нет поля в файле = false')
  assert.deepEqual(withBirthdayHidden({ notes: 'x' }, true, { birthdayHidden: false }), { notes: 'x', birthdayHidden: true })
  assert.deepEqual(withBirthdayHidden({}, false, { birthdayHidden: true }), { birthdayHidden: false })
})
