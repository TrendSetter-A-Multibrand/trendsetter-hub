import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../core/api/index.js'

// GET path -> { data, error, reload }. data === null, пока нет первого ответа; при reload старые данные остаются.
export function useLoad(path) {
  const [state, setState] = useState({ data: null, error: null })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    api
      .get(path)
      .then((data) => alive && setState({ data, error: null }))
      .catch((e) => alive && setState((s) => ({ ...s, error: e.message })))
    return () => {
      alive = false
    }
  }, [path, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { ...state, reload }
}
