import { ApiError, defaultMessage } from '../client.js'

const DELAY_MS = 200

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Шаблон "METHOD /path/:id" -> { regexp, keys }
function compile(route) {
  const [method, pattern] = route.split(' ')
  const keys = []
  const source = pattern.replace(/:([a-z_]+)/g, (_, key) => {
    keys.push(key)
    return '([^/]+)'
  })
  return { method, regexp: new RegExp(`^${source}$`), keys, route }
}

export function createMockTransport(handlers) {
  const routes = Object.keys(handlers).map(compile)

  return async function transport({ method, path, body, token }) {
    await wait(DELAY_MS)
    const [pathname, queryString = ''] = path.split('?')
    const query = Object.fromEntries(new URLSearchParams(queryString))
    for (const { method: m, regexp, keys, route } of routes) {
      if (m !== method) continue
      const match = regexp.exec(pathname)
      if (!match) continue
      const params = {}
      keys.forEach((key, i) => {
        params[key] = decodeURIComponent(match[i + 1])
      })
      const result = await handlers[route]({
        params,
        query,
        body: body === undefined ? undefined : structuredClone(body),
        token,
      })
      return result === undefined ? undefined : structuredClone(result)
    }
    throw new ApiError(404, defaultMessage(404))
  }
}
