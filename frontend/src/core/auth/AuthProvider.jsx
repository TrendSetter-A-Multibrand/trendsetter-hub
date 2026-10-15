import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, getToken, setToken, clearToken } from '../api/index.js'
import { AuthContext } from './AuthContext.js'

export default function AuthProvider({ children }) {
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(() => Boolean(getToken()))

  const refreshMe = useCallback(async () => {
    if (!getToken()) {
      setMe(null)
      return null
    }
    try {
      const profile = await api.get('/core/me')
      setMe(profile)
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
    () => ({ me, loading, login, demoLogin, logout, refreshMe }),
    [me, loading, login, demoLogin, logout, refreshMe],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
