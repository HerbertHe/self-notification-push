import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { basicAuth } from './middleware/basic-auth'
import { miscRoutes } from './routes/misc'
import { registerRoutes } from './routes/register'
import { mcpRoutes } from './routes/mcp'
import { pushRoutes } from './routes/push'

export const barkApp = new Hono<AppEnv>()

barkApp.use('*', async (c, next) => {
  await next()
  c.header('Server', 'Bark')
})
barkApp.use('*', basicAuth)
barkApp.route('/', miscRoutes)
barkApp.route('/', registerRoutes)
barkApp.route('/', mcpRoutes)
barkApp.route('/', pushRoutes)
