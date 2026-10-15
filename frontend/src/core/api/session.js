// Сессия демо: токен `mock:<userId>` в sessionStorage.
const KEY = 'hub.token'

export const getToken = () => sessionStorage.getItem(KEY)
export const setToken = (token) => sessionStorage.setItem(KEY, token)
export const clearToken = () => sessionStorage.removeItem(KEY)
