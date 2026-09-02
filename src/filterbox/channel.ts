import type { Bindings } from '../env'
import { BarkError } from '../bark/response'
import { BarkChannel } from './bark-channel'

export type ChannelResult = {
  data?: unknown
}

export interface NotificationChannel {
  readonly name: string
  send(input: Record<string, unknown>): Promise<ChannelResult>
}

export function resolveChannel(name: string, env: Bindings): NotificationChannel {
  if (name === 'bark') return new BarkChannel(env)
  throw new BarkError(400, `unsupported channel: ${name}`)
}
