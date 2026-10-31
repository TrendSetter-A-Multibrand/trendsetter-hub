import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { CITY_DATA } from './cityCatalog.data.js'
import { POPULAR_CITY_IDS, cityById, cityName, countryName, normalize, searchCities, translit } from './cityCatalog.js'
import { isValidZone } from './clocks.js'

const backend = JSON.parse(readFileSync(new URL('../../../../backend/app/core/data/home_cities.json', import.meta.url), 'utf8'))
const first = (q) => searchCities(q)[0]

test('синхронизация с бэкендом: те же id (и порядок) и те же зоны', () => {
  assert.deepEqual(CITY_DATA.map((r) => r[0]), backend.cities.map((c) => c.id))
  for (const c of backend.cities) assert.equal(cityById(c.id).timeZone, c.timezone, c.id)
})

test('размер файла данных не больше 120 КБ', () => {
  assert.ok(statSync(new URL('./cityCatalog.data.js', import.meta.url)).size <= 120 * 1024)
})

test('пары (название, страна) уникальны, id уникальны, зоны валидны', () => {
  assert.equal(new Set(CITY_DATA.map((r) => `${r[1]}|${r[3]}`)).size, CITY_DATA.length)
  assert.equal(new Set(CITY_DATA.map((r) => r[0])).size, CITY_DATA.length)
  for (const r of CITY_DATA) assert.ok(isValidZone(r[4]), `${r[0]} ${r[4]}`)
})

test('у каждого города русское название (кириллица), en и код страны', () => {
  for (const [id, name, en, cc] of CITY_DATA) {
    assert.match(name, /[А-Яа-яЁё]/, id)
    assert.ok(en && /^[A-Z]{2}$/.test(cc), id)
  }
})

test('17 популярных: легаси-записи первыми, с непустыми en и cc', () => {
  assert.equal(POPULAR_CITY_IDS.length, 17)
  assert.deepEqual(POPULAR_CITY_IDS.slice(0, 3), ['yerevan', 'moscow', 'saintPetersburg'])
  for (const id of POPULAR_CITY_IDS) {
    const c = cityById(id)
    assert.ok(c.en && c.cc, id)
  }
})

test('cityById / cityName: известные и неизвестные id', () => {
  assert.equal(cityById('kazan').name, 'Казань')
  assert.equal(cityName('g2643743'), 'Лондон')
  for (const id of ['paris', 'g0', '', null, undefined, '__proto__', 'constructor']) {
    assert.equal(cityById(id), null, String(id))
    assert.equal(cityName(id), null, String(id))
  }
})

test('выборочные названия: Ереван, Гюмри, Ванадзор, Петропавловск-Камчатский, Нью-Йорк, Пекин, Сидней, Каир', () => {
  for (const name of ['Ереван', 'Гюмри', 'Ванадзор', 'Москва', 'Петропавловск-Камчатский', 'Алматы', 'Астана', 'Минск', 'Киев', 'Лондон', 'Нью-Йорк', 'Пекин', 'Мумбаи', 'Сан-Паулу', 'Сидней', 'Каир']) {
    assert.ok(CITY_DATA.some((r) => r[1] === name), name)
  }
})

test('searchCities: «моск» — первой Москва; «moskva» и «Moscow» — Москва', () => {
  assert.equal(first('моск').name, 'Москва')
  assert.equal(first('моск').id, 'moscow')
  assert.equal(first('moskva').id, 'moscow')
  assert.equal(first('Moscow').id, 'moscow')
})

test('searchCities: «питер» — Санкт-Петербург', () => {
  assert.equal(first('питер').id, 'saintPetersburg')
})

test('searchCities: «ереван» с любым регистром и пробелами — Ереван первым', () => {
  for (const q of ['ереван', 'Ереван', '  ереван ']) assert.equal(first(q).id, 'yerevan', q)
})

test('searchCities: «сан-хосе» — не меньше 2 результатов из разных стран', () => {
  const found = searchCities('сан-хосе')
  assert.ok(found.length >= 2)
  assert.ok(new Set(found.map((c) => c.cc)).size >= 2)
})

test('searchCities: ё и е эквивалентны', () => {
  assert.deepEqual(searchCities('кишинев').map((c) => c.id), searchCities('кишинёв').map((c) => c.id))
  assert.ok(searchCities('кишинев').length > 0)
})

test('searchCities: пустой запрос — 17 популярных; limit; мусор — пусто', () => {
  assert.deepEqual(searchCities('').map((c) => c.id), POPULAR_CITY_IDS)
  assert.deepEqual(searchCities('   ').map((c) => c.id), POPULAR_CITY_IDS)
  assert.equal(searchCities('а').length, 50)
  assert.equal(searchCities('а', 5).length, 5)
  assert.deepEqual(searchCities('qzxwv'), [])
  assert.deepEqual(searchCities('###'), [])
})

test('searchCities: страна и строки alt', () => {
  assert.ok(searchCities('армения').some((c) => c.id === 'g616635'))
  assert.equal(first('алма-ата').id, 'almaty')
})

test('countryName / normalize / translit', () => {
  assert.equal(countryName('AM'), 'Армения')
  assert.equal(normalize("  Ёлка-Н’Джамена.  "), 'елка н джамена')
  assert.equal(translit('Москва'), 'moskva')
  assert.equal(translit('Щёлково'), 'shchelkovo')
})
