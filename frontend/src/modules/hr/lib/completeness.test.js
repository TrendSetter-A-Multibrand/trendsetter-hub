import test from 'node:test'
import assert from 'node:assert/strict'
import { completeness, levelOf } from './completeness.js'

const f = (key, label, extra = {}) => ({ key, label, kind: 'text', active: true, required: true, ...extra })
const fields = [
  f('first_name', 'Имя'),
  f('title', 'Должность'),
  f('hobbies', 'Увлечения', { kind: 'chips' }),
  f('telegram', 'Telegram'),
  f('manager_claim', 'Руководитель', { required: true }),
  f('nick', 'Ник', { required: false }),
  f('old', 'Старое', { active: false }),
  f('photo', 'Фото', { kind: 'photo' }),
]

test('колонки берутся с верхнего уровня, остальное из answers; необязательные/скрытые/manager_claim не считаются', () => {
  const r = completeness(fields, { firstName: 'Ада', title: '', hasPhoto: true, answers: { hobbies: ['чай'], telegram: '' } })
  assert.equal(r.percent, 60) // заполнены имя, увлечения, фото из 5
  assert.deepEqual(r.missing, ['Должность', 'Telegram'])
})

test('фото учитывается; пустой список и пробелы — пусто', () => {
  const r = completeness(fields, { firstName: ' ', title: 'Х', hasPhoto: false, answers: { hobbies: [], telegram: 'a' } })
  assert.deepEqual(r.missing, ['Имя', 'Увлечения', 'Фото'])
  assert.equal(r.percent, 40)
})

test('полная карточка = 100, уровни', () => {
  const r = completeness(fields, { firstName: 'А', title: 'Х', hasPhoto: true, answers: { hobbies: ['а'], telegram: 'a' } })
  assert.equal(r.percent, 100)
  assert.deepEqual(r.missing, [])
  assert.deepEqual([levelOf(90), levelOf(89), levelOf(50), levelOf(49)], ['success', 'warning', 'warning', 'error'])
})
