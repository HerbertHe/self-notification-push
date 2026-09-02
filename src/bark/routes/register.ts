import { Hono, type Context } from 'hono'
import type { AppEnv } from '../../env'
import { enabled } from '../../env'
import { DeviceRepository } from '../../repositories/device-repository'
import { parseRegistration } from '../parser'
import { success } from '../response'

export const registerRoutes = new Hono<AppEnv>()

registerRoutes.get('/register/:device_key', async (c) => {
  await new DeviceRepository(c.env.DB).findToken(c.req.param('device_key'))
  return c.json(success())
})

const register = async (c: Context<AppEnv>) => {
  const info = await parseRegistration(c)
  const repository = new DeviceRepository(c.env.DB)
  let deviceKey = info.deviceKey
  if (!deviceKey || !await repository.exists(deviceKey)) {
    if (!enabled(c.env.ALLOW_NEW_DEVICE, true)) {
      return c.json({ code: 500, message: 'device registration failed: register disabled' }, 500)
    }
    deviceKey = undefined
  }
  const key = await repository.save(deviceKey, info.deviceToken)
  return c.json(success({ key, device_key: key, device_token: info.deviceToken }))
}

registerRoutes.get('/register', register)
registerRoutes.post('/register', register)
