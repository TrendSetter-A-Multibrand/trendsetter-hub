import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeModuleAccess,
  isModuleResponsible,
  GROUP_PERMISSIONS,
  canSeeData,
  canRun,
  canManageUsers,
} from './access.js'

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
  [6, u('employee', [2]), [1], 'none'],
  [7, u('viewer', [1]), [1], 'structure'],
  [8, u('viewer', [2]), [1], 'structure'],
  [9, u('employee', []), [1], 'none'],
  [10, u('employee', [1]), [], 'none'],
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

const groupCases = [
  [17, u('viewer', []), [1], ['view'], 'view'],
  [18, u('viewer', []), [1], ['run'], 'run'],
  [19, u('employee', [2]), [1], ['view'], 'view'],
  [20, u('employee', [2]), [1], ['run'], 'run'],
  [21, u('employee', [2]), [1], ['responsible'], 'run'],
  [22, u('employee', [1]), [1], ['view'], 'run'],
  [23, u('employee', [1], { is_active: false }), [1], ['run'], 'none'],
  [24, u('boss', [1]), [1], ['run'], 'none'],
  [25, u('superuser', []), [1], ['view'], 'run'],
  [26, u('viewer', []), [1], ['view', 'run'], 'run'],
  [27, u('viewer', []), [1], [], 'structure'],
]

for (const [n, user, moduleDeps, groups, expected] of groupCases) {
  test(`computeModuleAccess #${n} (группы) -> ${expected}`, () => {
    assert.equal(computeModuleAccess(user, moduleDeps, groups), expected)
  })
}

test('computeModuleAccess: права групп по умолчанию пустые', () => {
  assert.equal(computeModuleAccess(u('viewer', []), [1]), 'structure')
})

const responsibleCases = [
  ['R1', u('employee', []), ['responsible'], true],
  ['R2', u('employee', []), ['run'], false],
  ['R3', u('admin', []), [], false],
  ['R4', u('employee', [], { is_active: false }), ['responsible'], false],
  ['R5', u('viewer', []), ['responsible'], true],
  ['R6', u('boss', []), ['responsible'], false],
]

for (const [n, user, groups, expected] of responsibleCases) {
  test(`isModuleResponsible ${n} -> ${expected}`, () => {
    assert.equal(isModuleResponsible(user, groups), expected)
  })
}

test('GROUP_PERMISSIONS', () => {
  assert.deepEqual(GROUP_PERMISSIONS, ['view', 'run', 'responsible'])
})

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
