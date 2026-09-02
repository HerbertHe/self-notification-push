import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../../env'
import { failure } from '../response'

export const basicAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const relativePath = new URL(c.req.url).pathname.replace(/^\/bark/, '') || '/'
  if (
    relativePath === '/ping' ||
    relativePath === '/healthz' ||
    relativePath === '/register' ||
    relativePath.startsWith('/register/')
  ) {
    return next()
  }

  const user = c.env.BASIC_AUTH_USER ?? ''
  const password = c.env.BASIC_AUTH_PASSWORD ?? ''
  const combined = c.env.BASIC_AUTH ?? ''
  if (!combined && !user && !password) return next()

  const authorization = c.req.header('authorization') ?? ''
  const actual = decodeBasicAuth(authorization)
  const valid = combined
    ? Boolean(actual && safeEqual(`${actual.user}:${actual.password}`, combined))
    : Boolean(actual && safeEqual(actual.user, user) && safeEqual(actual.password, password))
  if (!valid) {
    c.header('WWW-Authenticate', combined ? 'Basic realm="Bark"' : 'Basic realm="Coffee Time"')
    if (combined) return c.text('Unauthorized', 401)
    return c.json(failure(401, 'Unauthorized'), 401)
  }
  return next()
}

function decodeBasicAuth(value: string): { user: string; password: string } | undefined {
  if (!value.toLowerCase().startsWith('basic ')) return undefined
  try {
    const decoded = atob(value.slice(6).trim())
    const separator = decoded.indexOf(':')
    if (separator < 0) return undefined
    return { user: decoded.slice(0, separator), password: decoded.slice(separator + 1) }
  } catch {
    return undefined
  }
}

function safeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder()
  const a = encoder.encode(left)
  const b = encoder.encode(right)
  if (a.byteLength !== b.byteLength) return false
  let difference = 0
  for (let index = 0; index < a.byteLength; index += 1) difference |= a[index]! ^ b[index]!
  return difference === 0
}
