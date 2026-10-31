// Справочник городов (погода и «мой город»): поиск и подписи. Чистые функции, без React; ничего не импортирует из myCity.js.
// Данные — cityCatalog.data.js (генерируется backend/scripts/build_city_catalog.py, GeoNames CC BY 4.0), контракт — docs/TZ-weather-cities.md.
import { CITY_DATA } from './cityCatalog.data.js'

// 17 «популярных» (прежний список, прежний порядок): показываются при пустом запросе
export const POPULAR_CITY_IDS = CITY_DATA.slice(0, 17).map((row) => row[0])

const toCity = ([id, name, en, cc, timeZone, alt]) => ({ id, name, en, cc, timeZone, alt: alt ? alt.split('|') : [] })
const CITIES = CITY_DATA.map(toCity)
const BY_ID = new Map(CITIES.map((c) => [c.id, c]))

export const cityById = (id) => BY_ID.get(id) ?? null
export const cityName = (id) => BY_ID.get(id)?.name ?? null

// Название страны по-русски (справочник стран не храним); нет поддержки или ошибка — код страны
let regionNames
try {
  regionNames = new Intl.DisplayNames('ru', { type: 'region' })
} catch {
  regionNames = null
}
export function countryName(cc) {
  try {
    return regionNames?.of(cc) || cc
  } catch {
    return cc
  }
}

// Нижний регистр, ё -> е, дефисы, апострофы и точки -> пробел, схлопывание пробелов, обрезка
export const normalize = (str) =>
  String(str ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[-‐‑–—'’‘`.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// Упрощённая транслитерация русского названия (для поиска «moskva»)
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e',
  ю: 'yu', я: 'ya',
}
export const translit = (ru) =>
  [...normalize(ru)]
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')

// Индекс поиска строится один раз при импорте: ключ = название + en + alt + транслит названия + страна
const INDEX = CITIES.map((city) => {
  const name = normalize(city.name)
  const en = normalize(city.en)
  const key = [name, en, ...city.alt.map(normalize), translit(city.name), normalize(countryName(city.cc))].join(' ')
  return { city, name, en, key, words: key.split(' ') }
})

// Ранжирование: 1) название (русское или en) начинается с запроса; 2) с запроса начинается любое слово ключа; 3) вхождение подстроки.
// Внутри группы — порядок справочника. Пустой запрос — POPULAR_CITY_IDS.
export function searchCities(query, limit = 50) {
  const q = normalize(query)
  if (!q) return POPULAR_CITY_IDS.map((id) => BY_ID.get(id)).slice(0, limit)
  const groups = [[], [], []]
  for (const row of INDEX) {
    if (row.name.startsWith(q) || row.en.startsWith(q)) groups[0].push(row.city)
    else if (row.words.some((w) => w.startsWith(q)) || row.key.startsWith(q)) groups[1].push(row.city)
    else if (row.key.includes(q)) groups[2].push(row.city)
  }
  return groups.flat().slice(0, limit)
}
