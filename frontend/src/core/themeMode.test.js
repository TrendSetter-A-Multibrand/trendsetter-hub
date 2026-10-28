import test from 'node:test'
import assert from 'node:assert/strict'

const { initialMode, saveMode, THEME_KEY } = await import('./themeMode.js')

const setup = ({ stored = null, systemDark = false, broken = false } = {}) => {
  const store = new Map(stored ? [[THEME_KEY, stored]] : [])
  globalThis.window = {
    matchMedia: () => ({ matches: systemDark }),
    localStorage: broken
      ? { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
      : { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
  }
  return store
}

test('по умолчанию — системная тема', () => {
  setup({ systemDark: true })
  assert.equal(initialMode(), 'dark')
  setup({ systemDark: false })
  assert.equal(initialMode(), 'light')
})

test('сохранённый выбор важнее системной темы; мусор игнорируется', () => {
  setup({ stored: 'light', systemDark: true })
  assert.equal(initialMode(), 'light')
  setup({ stored: 'purple', systemDark: true })
  assert.equal(initialMode(), 'dark')
})

test('недоступное хранилище не ломает выбор', () => {
  setup({ broken: true, systemDark: true })
  assert.equal(initialMode(), 'dark')
  assert.doesNotThrow(() => saveMode('light'))
})

test('saveMode сохраняет выбор', () => {
  const store = setup()
  saveMode('dark')
  assert.equal(store.get(THEME_KEY), 'dark')
})
