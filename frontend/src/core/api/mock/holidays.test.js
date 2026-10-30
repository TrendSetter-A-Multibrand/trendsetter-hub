import test from 'node:test'
import assert from 'node:assert/strict'

// client.js -> session.js работает с sessionStorage — в Node его нет
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

const { ApiError } = await import('../client.js')
const { computeModuleAccess } = await import('../../access.js')
const { data } = await import('./data.js')
const { createHolidaysHandlers } = await import('./holidays.js')

const ADMIN = 'mock:1'
const EMPLOYEE = 'mock:3'
const VIEWER = 'mock:5'
const EDITOR = 'mock:9' // «Сотрудник HR» — демо-редактор
const NOW = new Date('2026-06-15T12:00:00Z')
// Тексты ошибок в приложении приходят из реестра модулей; в тесте достаточно заглушки
const errors = new Proxy({}, { get: (_, key) => String(key) })

const userFromToken = (token) => {
  if (!token) throw new ApiError(401, 'unauthorized')
  return data.users.find((u) => u.id === Number(token.split(':')[1]))
}
const accessTo = (user) => computeModuleAccess(user, [], [], true)
const isEditor = (user) => user.access_level === 'admin' || data.userModulePermissions[user.id]?.holidays === 'responsible'

function setup() {
  const { handlers } = createHolidaysHandlers({ userFromToken, accessTo, isEditor, errors, now: () => NOW })
  const get = (token, start, end) => handlers['GET /modules/holidays/days']({ query: { start, end }, token })
  const set = (token, body) => handlers['POST /modules/holidays/days']({ body, token })
  const del = (token, body) => handlers['POST /modules/holidays/days/delete']({ body, token })
  return { get, set, del }
}

const body = (over = {}) => ({ country: 'RU', start: '2027-01-01', end: '2027-01-08', kind: 'holiday', name: 'Каникулы', ...over })
const fails = (fn, status, message) =>
  assert.throws(fn, (e) => e instanceof ApiError && e.status === status && (message === undefined || e.message === message || e.message.startsWith(message)))

test('права: 401 без токена, 403 viewer, 403 запись не-редактору', () => {
  const { get, set, del } = setup()
  fails(() => get(undefined, '2026-01-01', '2026-12-31'), 401)
  fails(() => get(VIEWER, '2026-01-01', '2026-12-31'), 403)
  assert.ok(get(EMPLOYEE, '2026-01-01', '2026-12-31').days.length > 0)
  fails(() => set(EMPLOYEE, body()), 403)
  fails(() => del(EMPLOYEE, { country: 'RU', start: '2027-01-01', end: '2027-01-02' }), 403)
  fails(() => set(undefined, body()), 401)
  assert.ok(set(EDITOR, body()).days.length === 8)
  assert.ok(set(ADMIN, body({ country: 'AM' })).days.length === 8)
})

test('демо-данные: обе страны, текущий и следующий год, отсортированы', () => {
  const { get } = setup()
  const days = [...get(EMPLOYEE, '2026-01-01', '2026-12-31').days, ...get(EMPLOYEE, '2027-01-01', '2027-12-31').days]
  assert.deepEqual(new Set(days.map((d) => d.country)), new Set(['AM', 'RU']))
  assert.ok(days.some((d) => d.date.startsWith('2027-')))
  const year = get(EMPLOYEE, '2026-01-01', '2026-12-31').days
  assert.deepEqual(year, [...year].sort((a, b) => a.country.localeCompare(b.country) || a.date.localeCompare(b.date)))
  assert.ok(days.filter((d) => d.kind === 'workday').every((d) => [0, 6].includes(new Date(`${d.date}T00:00:00Z`).getUTCDay())))
})

test('запись диапазона: 8 дней, upsert перезаписывает только часть', () => {
  const { get, set } = setup()
  assert.equal(set(EDITOR, body({ start: '2030-01-01', end: '2030-01-08' })).days.length, 8)
  set(EDITOR, body({ start: '2030-01-05', end: '2030-01-06', kind: 'day_off', name: '   ' }))
  const days = get(EDITOR, '2030-01-01', '2030-01-31').days.filter((d) => d.country === 'RU')
  assert.equal(days.length, 8)
  assert.deepEqual(days.filter((d) => d.kind === 'day_off').map((d) => [d.date, d.name]), [['2030-01-05', null], ['2030-01-06', null]])
  assert.equal(set(EDITOR, body({ start: '2030-01-12', end: '2030-01-12', kind: 'short', name: null })).days[0].kind, 'short') // суббота
})

test('валидация: 422 по каждому правилу и ничего не записано', () => {
  const { get, set } = setup()
  const cases = [
    [{ kind: 'workday', start: '2030-02-02', end: '2030-02-04' }, 'workdayWeekend'], // в диапазоне есть понедельник
    [{ name: null }, 'nameRequired'],
    [{ name: '   ' }, 'nameRequired'],
    [{ name: 'я'.repeat(101) }, 'invalid'],
    [{ start: '2030-02-01', end: '2030-03-04' }, 'rangeTooLong'],
    [{ start: '2030-02-08', end: '2030-02-01' }, 'rangeOrder'],
    [{ start: '1999-12-30', end: '1999-12-31' }, 'datesOutOfRange'],
    [{ country: 'US' }, 'invalid'],
    [{ kind: 'weekend' }, 'invalid'],
    [{ extra: 1 }, 'invalid'],
    [{ start: '2030-13-01' }, 'invalid'],
  ]
  for (const [over, message] of cases) fails(() => set(EDITOR, body({ start: '2030-02-01', end: '2030-02-08', ...over })), 422, message)
  assert.equal(get(EDITOR, '2030-02-01', '2030-03-31').days.length, 0)
  assert.equal(set(EDITOR, body({ kind: 'workday', start: '2030-02-02', end: '2030-02-03', name: null })).days.length, 2)
})

test('чтение: границы включительно, период не больше 400 дней, порядок дат', () => {
  const { get, set } = setup()
  set(EDITOR, body({ start: '2031-01-01', end: '2031-01-01' }))
  set(EDITOR, body({ start: '2031-01-03', end: '2031-01-03' }))
  assert.equal(get(EDITOR, '2031-01-01', '2031-01-03').days.length, 2)
  assert.equal(get(EDITOR, '2031-01-01', '2032-02-05').start, '2031-01-01') // 400 дней разницы
  fails(() => get(EDITOR, '2031-01-01', '2032-02-06'), 422, 'periodTooLong')
  fails(() => get(EDITOR, '2031-01-10', '2031-01-01'), 422, 'rangeOrder')
  fails(() => get(EDITOR, '1999-01-01', '1999-02-01'), 422, 'datesOutOfRange')
  fails(() => get(EDITOR, '2031-01-01', undefined), 422)
})

test('удаление диапазоном: count, повтор — 0, соседи и другая страна не тронуты', () => {
  const { get, set, del } = setup()
  set(EDITOR, body({ start: '2032-01-01', end: '2032-01-08' }))
  set(EDITOR, body({ start: '2032-01-01', end: '2032-01-08', country: 'AM' }))
  const range = { country: 'RU', start: '2032-01-03', end: '2032-01-05' }
  assert.deepEqual(del(EDITOR, range), { count: 3 })
  assert.deepEqual(del(EDITOR, range), { count: 0 })
  const days = get(EDITOR, '2032-01-01', '2032-01-31').days
  assert.deepEqual(days.filter((d) => d.country === 'RU').map((d) => d.date), ['2032-01-01', '2032-01-02', '2032-01-06', '2032-01-07', '2032-01-08'])
  assert.equal(days.filter((d) => d.country === 'AM').length, 8)
  fails(() => del(EDITOR, { ...range, start: '2032-01-08', end: '2032-01-01' }), 422, 'rangeOrder')
  fails(() => del(EDITOR, { ...range, end: '2032-03-01' }), 422, 'rangeTooLong')
  fails(() => del(EDITOR, { ...range, extra: 1 }), 422, 'invalid')
})
