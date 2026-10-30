import test from 'node:test'
import assert from 'node:assert/strict'
import { onboardingStep } from './onboarding.js'

test('onboardingStep: все сочетания флагов', () => {
  assert.equal(onboardingStep({ must_change_password: true, onboarding: true }), 'password')
  assert.equal(onboardingStep({ must_change_password: true, onboarding: false }), 'password')
  assert.equal(onboardingStep({ must_change_password: false, onboarding: true }), 'profile')
  assert.equal(onboardingStep({ must_change_password: false, onboarding: false }), null)
})

test('onboardingStep: ответ без флагов и пустой профиль — обычный пользователь', () => {
  assert.equal(onboardingStep({ id: 1 }), null)
  assert.equal(onboardingStep(null), null)
  assert.equal(onboardingStep(undefined), null)
})
