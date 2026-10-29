// Шаг онбординга по ответу /core/me: "password" — смена стартового пароля, "profile" — анкета и проверка HR, null — обычный пользователь.
export function onboardingStep(me) {
  if (me?.must_change_password) return 'password'
  if (me?.onboarding) return 'profile'
  return null
}
