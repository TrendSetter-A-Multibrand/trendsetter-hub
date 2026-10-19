import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, getToken, setToken, clearToken, onSessionExpired } from '../api/index.js'
import { AuthContext } from './AuthContext.js'

export default function AuthProvider({ children }) {
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(() => Boolean(getToken()))
  const [expired, setExpired] = useState(false)

  // Токен истёк посреди работы: RequireAuth сам вернёт на вход, место работы запоминается в location.state
  useEffect(
    () =>
      onSessionExpired(() => {
        setMe(null)
        setExpired(true)
      }),
    [],
  )

  const refreshMe = useCallback(async () => {
    if (!getToken()) {
      setMe(null)
      return null
    }
    try {
      const profile = await api.get('/core/me')
      setMe(profile)
      setExpired(false)
      return profile
    } catch {
      clearToken()
      setMe(null)
      return null
    }
  }, [])

  useEffect(() => {
    if (!getToken()) return
    api
      .get('/core/me')
      .then(setMe)
      .catch(() => clearToken())
      .finally(() => setLoading(false))
  }, [])

  // TODO(Q-G5): тихое обновление /core/me (возврат на вкладку и раз в 60 с), чтобы права групп действовали без перелогина.
  // Ошибки игнорируются и токен не очищается: 401 обрабатывает client.js через onSessionExpired.
  const syncMe = useCallback(async () => {
    if (!getToken()) return
    try {
      const profile = await api.get('/core/me')
      if (!getToken()) return // вышли или сессия истекла, пока шёл запрос — профиль не воскрешаем
      setMe((prev) => (JSON.stringify(prev) === JSON.stringify(profile) ? prev : profile))
    } catch {
      // сеть или 401: ничего не делаем
    }
  }, [])

  const hasMe = Boolean(me)
  const syncRef = useRef(syncMe)
  useEffect(() => {
    syncRef.current = syncMe
  }, [syncMe])
  useEffect(() => {
    if (!hasMe) return undefined
    const onVisible = () => {
      if (document.visibilityState === 'visible') syncRef.current()
    }
    const onFocus = () => syncRef.current()
    const timer = setInterval(() => syncRef.current(), 60000)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [hasMe])

  const login = useCallback(
    async (email, password) => {
      const { token } = await api.post('/auth/login', { email, password })
      setToken(token)
      await refreshMe()
    },
    [refreshMe],
  )

  const demoLogin = useCallback(
    async (userId) => {
      const { token } = await api.post('/auth/demo-login', { user_id: userId })
      setToken(token)
      await refreshMe()
    },
    [refreshMe],
  )

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout')
    } finally {
      clearToken()
      setMe(null)
    }
  }, [])

  const value = useMemo(
    () => ({ me, loading, expired, login, demoLogin, logout, refreshMe, syncMe }),
    [me, loading, expired, login, demoLogin, logout, refreshMe, syncMe],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
