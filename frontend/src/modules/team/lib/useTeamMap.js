import { useEffect, useState } from 'react'
import { api } from '../../../core/api/index.js'
import { softDirections } from '../../../core/palette.js'

// Загрузка карты команды: { status: 'loading' | 'ready' | 'error', map, error }
export function useTeamMap() {
  const [state, setState] = useState({ status: 'loading', map: null, error: null })
  useEffect(() => {
    let alive = true
    api
      .get('/modules/team/map')
      .then((map) => alive && setState({ status: 'ready', map: { ...map, directions: softDirections(map.directions) }, error: null }))
      .catch((e) => alive && setState({ status: 'error', map: null, error: e.message }))
    return () => {
      alive = false
    }
  }, [])
  return state
}

// Полное фото профиля (в карточках — только превью). Устаревшие ответы при быстром переключении игнорируются;
// 404 или ошибка — null, интерфейс остаётся на превью/инициалах.
export function useFullPhoto(personId, enabled) {
  const [loaded, setLoaded] = useState({ id: null, data: null })
  useEffect(() => {
    if (!enabled || personId === null) return undefined
    let alive = true
    api
      .get(`/modules/team/people/${personId}/photo`)
      .then((r) => alive && setLoaded({ id: personId, data: r.data }))
      .catch(() => alive && setLoaded({ id: personId, data: null }))
    return () => {
      alive = false
    }
  }, [personId, enabled])
  return enabled && loaded.id === personId ? loaded.data : null
}

// Моя анкета: GET /me ({ person, values, submission, photo }). enabled=false (structure) — не запрашивается.
// reload() перечитывает после отправки/отзыва. Ошибка не критична для карты: me остаётся null.
export function useMyProfile(enabled) {
  const [me, setMe] = useState(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!enabled) return undefined
    let alive = true
    api
      .get('/modules/team/me')
      .then((r) => alive && setMe(r))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [enabled, tick])
  return { me, reload: () => setTick((t) => t + 1) }
}
