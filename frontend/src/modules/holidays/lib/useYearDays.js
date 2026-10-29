import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../core/api/index.js'

// Строки календаря (обе страны) за год: GET /modules/holidays/days. { rows, error, reload }: rows === null и error === false — идёт загрузка.
// Смена года — новый запрос, устаревшие ответы игнорируются; reload() перечитывает тот же год (старые строки остаются на экране до ответа).
export function useYearDays(year) {
  const [state, setState] = useState({ year: null, rows: null, error: false })
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let alive = true
    api
      .get(`/modules/holidays/days?start=${year}-01-01&end=${year}-12-31`)
      .then((result) => alive && setState({ year, rows: result.days, error: false }))
      .catch(() => alive && setState({ year, rows: null, error: true }))
    return () => {
      alive = false
    }
  }, [year, version])
  const reload = useCallback(() => setVersion((v) => v + 1), [])
  return { ...(state.year === year ? state : { rows: null, error: false }), reload }
}
