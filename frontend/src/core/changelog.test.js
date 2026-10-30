import test from 'node:test'
import assert from 'node:assert/strict'
import { CHANGELOG, CURRENT_VERSION } from './changelog.js'

const SEMVER = /^\d+\.\d+\.\d+$/
const parts = (v) => v.split('.').map(Number)
const cmp = (a, b) => {
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

test('версии уникальны и в формате semver', () => {
  const versions = CHANGELOG.map((r) => r.version)
  versions.forEach((v) => assert.match(v, SEMVER))
  assert.equal(new Set(versions).size, versions.length)
})

test('релизы идут по убыванию версии, текущая — первая', () => {
  for (let i = 1; i < CHANGELOG.length; i += 1) {
    assert.ok(cmp(CHANGELOG[i - 1].version, CHANGELOG[i].version) > 0)
  }
  assert.equal(CURRENT_VERSION, CHANGELOG[0].version)
})

test('у каждого релиза есть дата и хотя бы один пункт', () => {
  CHANGELOG.forEach((r) => {
    assert.match(r.date, /^\d{2}\.\d{2}\.\d{4}$/)
    const n = [r.added, r.changed, r.fixed].reduce((s, l) => s + (l?.length ?? 0), 0)
    assert.ok(n > 0, r.version)
  })
})
