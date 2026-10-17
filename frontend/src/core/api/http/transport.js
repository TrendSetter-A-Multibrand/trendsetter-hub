import strings from '../../strings.js'
import { ApiError, defaultMessage } from '../client.js'

// Транспорт к настоящему бэкенду. Ошибки бэкенда приходят как {"detail": "<русский текст>"}.
export function createHttpTransport(baseUrl) {
  const root = baseUrl.replace(/\/+$/, '')
  return async function transport({ method, path, body, token }) {
    let response
    try {
      response = await fetch(root + path, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new ApiError(0, strings.errors.network)
    }
    const payload = await response.json().catch(() => undefined)
    if (!response.ok) {
      const detail = typeof payload?.detail === 'string' ? payload.detail : undefined
      throw new ApiError(response.status, detail ?? defaultMessage(response.status))
    }
    return payload
  }
}
