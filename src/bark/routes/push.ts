import { Hono, type Context } from 'hono'
import type { AppEnv } from '../../env'
import { maxBatchCount } from '../../env'
import { parseDeviceKeys, parsePushRequest } from '../parser'
import { PushService } from '../push-service'
import { BarkError, success } from '../response'

export const pushRoutes = new Hono<AppEnv>()

pushRoutes.post('/push', async (c) => {
  return handlePush(c, {})
})

const legacy = async (c: Context<AppEnv>) => {
  return handlePush(c, {
    device_key: c.req.param('device_key'),
    title: c.req.param('title'),
    subtitle: c.req.param('subtitle'),
    body: c.req.param('body'),
  })
}

async function handlePush(c: Context<AppEnv>, pathParams: Record<string, string | undefined>) {
  const params = await parsePushRequest(c, pathParams)
  const deviceKeys = params.device_keys !== undefined ? parseDeviceKeys(params) : []
  const service = new PushService(c.env)
  if (deviceKeys.length === 0) {
    await service.push(params)
    return c.json(success())
  }
  const max = maxBatchCount(c.env)
  if (max !== -1 && deviceKeys.length > max) {
    throw new BarkError(400, `batch push count exceeds the maximum limit: ${max}`)
  }
  return c.json(success(await service.pushBatch(deviceKeys, params)))
}

// Keep dynamic compatibility routes last in the Bark sub-app.
for (const path of [
  '/:device_key/:title/:subtitle/:body',
  '/:device_key/:title/:body',
  '/:device_key/:body',
  '/:device_key',
]) {
  pushRoutes.get(path, legacy)
  pushRoutes.post(path, legacy)
}
