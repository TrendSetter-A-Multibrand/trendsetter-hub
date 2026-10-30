import test from 'node:test'
import assert from 'node:assert/strict'
import { CITY_ZONES, MY_CITY_KEY, clockZones, loadMyCity, saveMyCity } from './myCity.js'

const NOW = new Date('2026-10-29T09:00:00Z')
const ids = (zones) => zones.map((z) => z.id)

const fakeStorage = (initial = {}) => {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v)
    },
    removeItem: (k) => {
      delete data[k]
    },
  }
}

test('CITY_ZONES: 17 городов, первые два — Ереван и Москва', () => {
  assert.equal(CITY_ZONES.length, 17)
  assert.equal(new Set(CITY_ZONES.map((c) => c.id)).size, 17)
  assert.deepEqual(ids(CITY_ZONES.slice(0, 2)), ['yerevan', 'moscow'])
})

test('clockZones: без выбора и Ереван — как V1', () => {
  assert.deepEqual(ids(clockZones(null, NOW)), ['yerevan', 'moscow'])
  assert.deepEqual(ids(clockZones(undefined, NOW)), ['yerevan', 'moscow'])
  assert.deepEqual(ids(clockZones('yerevan', NOW)), ['yerevan', 'moscow'])
  assert.deepEqual(ids(clockZones('nowhere', NOW)), ['yerevan', 'moscow'])
})

test('clockZones: город с московским временем — вторым Ереван', () => {
  for (const id of ['moscow', 'kazan', 'minsk', 'istanbul', 'saintPetersburg']) {
    assert.deepEqual(ids(clockZones(id, NOW)), [id, 'yerevan'], id)
  }
})

test('clockZones: прочие города — вторым Москва', () => {
  for (const id of ['novosibirsk', 'tbilisi', 'dubai', 'belgrade']) {
    assert.deepEqual(ids(clockZones(id, NOW)), [id, 'moscow'], id)
  }
})

test('clockZones: сравнивается текущее время, а не id зоны (Белград — не московское)', () => {
  assert.deepEqual(ids(clockZones('belgrade', new Date('2026-07-01T09:00:00Z'))), ['belgrade', 'moscow'])
})

test('loadMyCity / saveMyCity', () => {
  assert.equal(loadMyCity(fakeStorage()), null)
  assert.equal(loadMyCity(fakeStorage({ [MY_CITY_KEY]: 'kazan' })), 'kazan')
  assert.equal(loadMyCity(fakeStorage({ [MY_CITY_KEY]: 'paris' })), null)
  assert.equal(loadMyCity(fakeStorage({ [MY_CITY_KEY]: '{"x":1}' })), null)
  assert.equal(loadMyCity({ getItem: () => { throw new Error('denied') } }), null)
  const st = fakeStorage()
  saveMyCity(st, 'kazan')
  assert.equal(st.data[MY_CITY_KEY], 'kazan')
  saveMyCity(st, null)
  assert.equal(MY_CITY_KEY in st.data, false)
  assert.doesNotThrow(() => saveMyCity({ setItem: () => { throw new Error('denied') } }, 'kazan'))
})
