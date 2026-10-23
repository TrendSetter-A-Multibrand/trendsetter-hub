import { useEffect, useMemo, useState } from 'react'
import { api } from '../../../core/api/index.js'

// Дни рождения за месяцы 'YYYY-MM': GET /modules/hr/birthdays?month=. Возвращает [{ month, items }]; null, пока нет ответа
// (при ошибке/403 месяц приходит с пустым списком — метки просто нет). enabled=false (уровень structure) — не запрашивается.
export function useBirthdays(months, enabled) {
  const key = [...new Set(months)].sort().join(',')
  const [state, setState] = useState({ key: null, entries: [] })
  useEffect(() => {
    if (!enabled) return undefined
    let alive = true
    Promise.all(
      key.split(',').map((month) =>
        api
          .get(`/modules/hr/birthdays?month=${month}`)
          .then((items) => ({ month, items }))
          .catch(() => ({ month, items: [] })),
      ),
    ).then((entries) => alive && setState({ key, entries }))
    return () => {
      alive = false
    }
  }, [key, enabled])
  return useMemo(() => (enabled && state.key === key ? state.entries : null), [enabled, state, key])
}
