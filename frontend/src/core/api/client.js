import strings from '../strings.js'
import { getToken, clearToken } from './session.js'

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const DEFAULT_MESSAGES = {
  401: strings.errors.unauthorized,
  403: strings.errors.forbidden,
  404: strings.errors.notFound,
  409: strings.errors.conflict,
  422: strings.errors.invalid,
}

export const defaultMessage = (status) => DEFAULT_MESSAGES[status] ?? strings.errors.unknown

// Транспорт: async ({method, path, body, token}) => данные; ошибки — ApiError.
export function createClient(transport) {
  async function request(method, path, body) {
    try {
      return await transport({ method, path, body, token: getToken() })
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) clearToken()
      throw error
    }
  }
  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
  }
}
