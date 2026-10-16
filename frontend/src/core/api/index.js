// Единственное место, где выбирается транспорт.
import { createClient } from './client.js'
import { createMockTransport } from './mock/transport.js'
import { handlers } from './mock/handlers.js'
import { createHttpTransport } from './http/transport.js'
import { API_URL } from '../config.js'

export { ApiError } from './client.js'
export { getToken, setToken, clearToken } from './session.js'

export const api = createClient(API_URL ? createHttpTransport(API_URL) : createMockTransport(handlers))
