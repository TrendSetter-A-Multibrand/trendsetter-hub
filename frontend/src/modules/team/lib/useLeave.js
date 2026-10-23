import { useEffect, useState } from 'react'
import { api } from '../../../core/api/index.js'

// Календарь отпусков за диапазон: GET /modules/hr/leave/calendar. { data, error }: data === null и error === null — идёт загрузка.
// Устаревшие ответы при быстрой смене диапазона игнорируются. enabled=false — не запрашивается (уровень structure).
export function useLeaveRange(from, to, enabled) {
  const key = `${from}|${to}`
  const [state, setState] = useState({ key: null, data: null, error: null })
  useEffect(() => {
    if (!enabled) return undefined
    let alive = true
    api
      .get(`/modules/hr/leave/calendar?from=${from}&to=${to}`)
      .then((data) => alive && setState({ key, data, error: null }))
      .catch((e) => alive && setState({ key, data: null, error: e.message }))
    return () => {
      alive = false
    }
  }, [from, to, enabled, key])
  return state.key === key ? state : { key, data: null, error: null }
}
