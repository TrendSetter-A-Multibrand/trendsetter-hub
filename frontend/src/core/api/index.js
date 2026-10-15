// Единственное место, где выбирается транспорт.
// TODO: позже здесь появится выбор http/transport.js (реальный бэкенд) без правки экранов.
import { createClient } from './client.js'
import { createMockTransport } from './mock/transport.js'
import { handlers } from './mock/handlers.js'

export { ApiError } from './client.js'
export { getToken, setToken, clearToken } from './session.js'

export const api = createClient(createMockTransport(handlers))
