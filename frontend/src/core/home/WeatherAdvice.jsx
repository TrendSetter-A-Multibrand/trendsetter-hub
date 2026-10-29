import { adviceFor, adviceText } from './weather.js'

// Временное решение (решение пользователя 29.10): подсказка «как одеваться» строкой под приветствием.
// Город — активная кнопка переключателя погоды (TODO(Q-P3)). Нет слотов или совета — ничего не выводим.
export default function WeatherAdvice({ data, cityId }) {
  const city = data?.cities?.find((c) => c.id === cityId)
  const today = city?.days?.[0]
  if (!today?.slots?.length) return null
  const advice = adviceFor(today.slots)
  if (!advice) return null
  return <p className="hero-advice">{adviceText(advice, { date: today.date, cityId: city.id })}</p>
}
