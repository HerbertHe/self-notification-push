import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../env'
import { failure } from '../bark/response'

export const backdoorAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const expected = c.env.BACKDOOR_API_KEY ?? ''
  if (!expected) return c.json(failure(404, 'Not Found'), 404)

  const authorization = c.req.header('authorization') ?? ''
  const received = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : ''
  if (!safeEqual(received, expected)) {
    c.header('WWW-Authenticate', 'Bearer')
    return c.json(failure(401, 'Unauthorized'), 401)
  }
  return next()
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
