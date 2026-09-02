import { Hono, type Context } from 'hono'
import type { AppEnv } from '../env'
import { now, success } from '../bark/response'
import { filterBoxAuth } from './auth'
import { resolveChannel } from './channel'
import { parseFilterBoxRequest } from './parser'

export const filterBoxApp = new Hono<AppEnv>()

filterBoxApp.get('/ping', (c) => c.json({ code: 200, message: 'pong', timestamp: now() }))
filterBoxApp.use('/webhook', filterBoxAuth)

const webhook = async (c: Context<AppEnv>) => {
  const input = await parseFilterBoxRequest(c)
  const channelName = String(input.channel ?? c.env.FILTERBOX_DEFAULT_CHANNEL ?? 'bark').toLowerCase()
  const result = await resolveChannel(channelName, c.env).send(input)
  return c.json(success(result.data))
}

filterBoxApp.get('/webhook', webhook)
filterBoxApp.post('/webhook', webhook)
