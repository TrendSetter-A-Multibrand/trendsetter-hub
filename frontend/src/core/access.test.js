import test from 'node:test'
import assert from 'node:assert/strict'
import { computeModuleAccess, canSeeData, canRun, canManageUsers } from './access.js'

const u = (access_level, department_ids, extra = {}) => ({
  access_level,
  department_ids,
  is_active: true,
  ...extra,
})

const cases = [
  [1, u('admin', []), [1], 'run'],
  [2, u('admin', [1]), [1], 'run'],
  [3, u('superuser', []), [1], 'run'],
  [4, u('superuser', [2]), [1], 'run'],
  [5, u('employee', [1]), [1], 'run'],
  [6, u('employee', [2]), [1], 'view'],
  [7, u('viewer', [1]), [1], 'structure'],
  [8, u('viewer', [2]), [1], 'structure'],
  [9, u('employee', []), [1], 'view'],
  [10, u('employee', [1]), [], 'view'],
  [11, u('employee', [2]), [1, 2], 'run'],
  [12, u('employee', [1, 3]), [3], 'run'],
  [13, u('employee', [1], { is_active: false }), [1], 'none'],
  [14, u('boss', [1]), [1], 'none'],
  [15, null, [1], 'none'],
  [16, u('admin', [], { is_active: false }), [1], 'none'],
]

for (const [n, user, moduleDeps, expected] of cases) {
  test(`computeModuleAccess #${n} -> ${expected}`, () => {
    assert.equal(computeModuleAccess(user, moduleDeps), expected)
  })
}

test('canManageUsers', () => {
  assert.equal(canManageUsers(u('admin', [])), true)
  assert.equal(canManageUsers(u('superuser', [])), false)
  assert.equal(canManageUsers(u('employee', [1])), false)
  assert.equal(canManageUsers(u('viewer', [])), false)
  assert.equal(canManageUsers(null), false)
  assert.equal(canManageUsers(u('admin', [], { is_active: false })), false)
})

test('canSeeData / canRun для всех значений', () => {
  assert.deepEqual(['none', 'structure', 'view', 'run'].map(canSeeData), [false, false, true, true])
  assert.deepEqual(['none', 'structure', 'view', 'run'].map(canRun), [false, false, false, true])
})
