import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../env'
import { failure } from '../bark/response'
import { SourceKeyRepository } from '../repositories/source-key-repository'

export const filterBoxAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authorization = c.req.header('authorization') ?? ''
  const received = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : ''
  if (!received || !await new SourceKeyRepository(c.env.DB).exists(received)) {
    c.header('WWW-Authenticate', 'Bearer')
    return c.json(failure(401, 'Unauthorized'), 401)
  }
  return next()
}
