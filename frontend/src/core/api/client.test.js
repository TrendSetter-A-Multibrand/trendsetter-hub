import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'

// session.js работает с sessionStorage — в Node его нет
const store = new Map()
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { ApiError, createClient, onSessionExpired } = await import('./client.js')
const { getToken, setToken } = await import('./session.js')

const failWith401 = async () => {
  throw new ApiError(401, 'x')
}

beforeEach(() => store.clear())

test('401 с токеном: токен чистится, подписчики узнают об истёкшей сессии', async () => {
  setToken('t')
  let calls = 0
  const off = onSessionExpired(() => calls++)
  await assert.rejects(createClient(failWith401).get('/core/me'), ApiError)
  off()
  assert.equal(getToken(), null)
  assert.equal(calls, 1)
})

test('401 без токена (неверный пароль при входе): подписчики не уведомляются', async () => {
  let calls = 0
  const off = onSessionExpired(() => calls++)
  await assert.rejects(createClient(failWith401).post('/auth/login', {}), ApiError)
  off()
  assert.equal(calls, 0)
})
