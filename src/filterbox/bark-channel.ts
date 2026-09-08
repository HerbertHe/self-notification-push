import type { Bindings } from '../env'
import { maxBatchCount } from '../env'
import { parseDeviceKeys } from '../bark/parser'
import { PushService } from '../bark/push-service'
import { BarkError } from '../bark/response'
import { DeviceRepository } from '../repositories/device-repository'
import type { ChannelResult, NotificationChannel } from './channel'
import { genericBody, genericTitle } from './parser'

export class BarkChannel implements NotificationChannel {
  readonly name = 'bark'

  constructor(private readonly env: Bindings) {}

  async send(input: Record<string, unknown>): Promise<ChannelResult> {
    const params = extractBarkParams(input)
    if (!Object.hasOwn(params, 'title')) params.title = genericTitle(input)
    if (!Object.hasOwn(params, 'body')) params.body = genericBody(input)

    const requestHasBatch = Object.hasOwn(params, 'device_keys')
    let deviceKeys = requestHasBatch ? parseDeviceKeys(params) : []
    const requestDeviceKey = stringValue(params.device_key)
    const implicitBroadcast = deviceKeys.length === 0 && !requestDeviceKey

    if (implicitBroadcast) {
      deviceKeys = await new DeviceRepository(this.env.DB).listActiveKeys()
      if (deviceKeys.length === 0) throw new BarkError(400, 'no registered Bark devices')
    }

    if (deviceKeys.length > 0) {
      const max = maxBatchCount(this.env)
      if (max !== -1 && deviceKeys.length > max) {
        throw new BarkError(400, `batch push count exceeds the maximum limit: ${max}`)
      }
      const results = await new PushService(this.env).pushBatch(deviceKeys, params)
      if (implicitBroadcast) {
        const succeeded = results.filter((result) => result.code === 200).length
        return { data: { total: results.length, succeeded, failed: results.length - succeeded } }
      }
      return { data: results }
    }

    if (!stringValue(params.device_key)) throw new BarkError(400, 'device key is empty')
    await new PushService(this.env).push(params)
    return {}
  }
}

export function extractBarkParams(input: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    const normalized = key.toLowerCase()
    if (normalized.startsWith('bark_')) params[normalized.slice(5)] = value
  }
  return params
}

function stringValue(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}
