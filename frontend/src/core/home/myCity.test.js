import test from 'node:test'
import assert from 'node:assert/strict'
import { CITY_ZONES, DEFAULT_CITY_IDS, MY_CITY_KEY, clockSlots, loadMyCity, saveMyCity } from './myCity.js'

const NOW = new Date('2026-10-29T09:00:00Z')
const ids = (zones) => zones.map((z) => z.cityId)
const NONE = [null, null]

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
  assert.deepEqual(CITY_ZONES.slice(0, 2).map((c) => c.id), ['yerevan', 'moscow'])
})

test('DEFAULT_CITY_IDS: Ереван и Москва, оба есть в CITY_ZONES', () => {
  assert.deepEqual(DEFAULT_CITY_IDS, ['yerevan', 'moscow'])
  assert.ok(DEFAULT_CITY_IDS.every((id) => CITY_ZONES.some((c) => c.id === id)))
})

test('clockSlots: без выбора и Ереван — как V1', () => {
  assert.deepEqual(ids(clockSlots(null, NONE, NOW)), ['yerevan', 'moscow'])
  assert.deepEqual(ids(clockSlots(undefined, NONE, NOW)), ['yerevan', 'moscow'])
  assert.deepEqual(ids(clockSlots('yerevan', NONE, NOW)), ['yerevan', 'moscow'])
  assert.deepEqual(ids(clockSlots('nowhere', NONE, NOW)), ['yerevan', 'moscow'])
})

test('clockSlots: город с московским временем — вторым Ереван', () => {
  for (const id of ['moscow', 'kazan', 'minsk', 'istanbul', 'saintPetersburg']) {
    assert.deepEqual(ids(clockSlots(id, NONE, NOW)), [id, 'yerevan'], id)
  }
})

test('clockSlots: прочие города — вторым Москва', () => {
  for (const id of ['novosibirsk', 'tbilisi', 'dubai', 'belgrade']) {
    assert.deepEqual(ids(clockSlots(id, NONE, NOW)), [id, 'moscow'], id)
  }
})

test('clockSlots: сравнивается текущее время, а не id зоны (Белград — не московское)', () => {
  assert.deepEqual(ids(clockSlots('belgrade', NONE, new Date('2026-07-01T09:00:00Z'))), ['belgrade', 'moscow'])
})

test('clockSlots: сохранённый слот 1 = Москва — слот 2 по умолчанию Ереван', () => {
  const slots = clockSlots('novosibirsk', ['Europe/Moscow', null], NOW)
  assert.deepEqual(slots.map((z) => z.timeZone), ['Europe/Moscow', 'Asia/Yerevan'])
})

test('clockSlots: сохранённый слот 2 не зависит от «моего города»', () => {
  for (const id of [null, 'kazan', 'novosibirsk']) {
    assert.equal(clockSlots(id, [null, 'America/Chicago'], NOW)[1].timeZone, 'America/Chicago', String(id))
  }
})

test('clockSlots: у сохранённой зоны cityId === null, у умолчания — id города', () => {
  const [a, b] = clockSlots('kazan', ['Asia/Tokyo', null], NOW)
  assert.equal(a.cityId, null)
  assert.equal(b.cityId, 'moscow')
  assert.equal(clockSlots('kazan', NONE, NOW)[0].cityId, 'kazan')
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
