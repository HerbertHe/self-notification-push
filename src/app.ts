import { Hono } from 'hono'
import type { AppEnv } from './env'
import { barkApp } from './bark/app'
import { BarkError, failure } from './bark/response'
import { filterBoxApp } from './filterbox/app'
import { backdoorApp } from './backdoor/app'

export const app = new Hono<AppEnv>()

app.get('/', (c) => c.json({
  service: 'self-notification-push',
  bark: '/bark',
  filterbox: '/filterbox',
  backdoor: '/backdoor',
}))
app.route('/bark', barkApp)
app.route('/filterbox', filterBoxApp)
app.route('/backdoor', backdoorApp)

app.notFound((c) => c.json(failure(404, 'Not Found'), 404))
app.onError((error, c) => {
  const status = error instanceof BarkError ? error.status : 500
  const message = error instanceof Error ? error.message : 'Internal Server Error'
  if (status >= 500) console.error(JSON.stringify({ event: 'request_error', status, message }))
  return c.json(failure(status, message), status as 400 | 401 | 404 | 405 | 409 | 413 | 500 | 502 | 503)
})
