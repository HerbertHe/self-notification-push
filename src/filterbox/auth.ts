import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../env'
import { isJsonContentType } from '../bark/parser'
import { failure } from '../bark/response'
import { SourceKeyRepository } from '../repositories/source-key-repository'
import { parseFilterBoxRequest } from './parser'

export const filterBoxAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const input = await parseFilterBoxRequest(c)
  const authorization = c.req.header('authorization')
  const headerToken = authorization?.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : ''
  const queryHasBodyAuthField = [...new URL(c.req.url).searchParams.keys()]
    .some((key) => key.toLowerCase() === 'x_snp_authorization')
  const bodyToken = c.req.method === 'POST'
    && isJsonContentType(c.req.header('content-type')?.toLowerCase() ?? '')
    && !queryHasBodyAuthField
    && typeof input.x_snp_authorization === 'string'
    ? input.x_snp_authorization.trim()
    : ''

  // Authentication data is private to the ingress and must never reach a channel adapter.
  delete input.x_snp_authorization
  c.set('filterBoxInput', input)

  const repository = new SourceKeyRepository(c.env.DB)
  const received = authorization !== undefined ? headerToken : bodyToken
  const authorized = Boolean(received) && await repository.exists(received)
  if (!authorized) {
    c.header('WWW-Authenticate', 'Bearer')
    return c.json(failure(401, 'Unauthorized'), 401)
  }
  return next()
}
