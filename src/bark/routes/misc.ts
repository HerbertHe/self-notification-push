import { Hono } from 'hono'
import type { AppEnv } from '../../env'
import { enabled } from '../../env'
import { DeviceRepository } from '../../repositories/device-repository'
import { now } from '../response'

export const miscRoutes = new Hono<AppEnv>()

miscRoutes.get('/', (c) => c.text('ok'))
miscRoutes.get('/ping', (c) => c.json({ code: 200, message: 'pong', timestamp: now() }))
miscRoutes.get('/healthz', (c) => c.text('ok'))
miscRoutes.get('/info', async (c) => {
  const devices = enabled(c.env.ALLOW_QUERY_NUMS, true)
    ? await new DeviceRepository(c.env.DB).count()
    : undefined
  return c.json({
    version: c.env.APP_VERSION ?? 'dev',
    build: c.env.BUILD_DATE ?? '',
    arch: 'cloudflare-workers/v8',
    commit: c.env.COMMIT_SHA ?? '',
    devices,
  })
})
