import type { Bindings } from '../env'
import { maxBatchCount } from '../env'
import { parseDeviceKeys } from '../bark/parser'
import { PushService } from '../bark/push-service'
import { BarkError } from '../bark/response'
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

    if (deviceKeys.length === 0 && !requestDeviceKey) {
      deviceKeys = parseConfiguredKeys(this.env.FILTERBOX_BARK_DEVICE_KEYS)
      if (deviceKeys.length === 1) {
        params.device_key = deviceKeys[0]
        deviceKeys = []
      }
    }

    if (deviceKeys.length > 0) {
      const max = maxBatchCount(this.env)
      if (max !== -1 && deviceKeys.length > max) {
        throw new BarkError(400, `batch push count exceeds the maximum limit: ${max}`)
      }
      return { data: await new PushService(this.env).pushBatch(deviceKeys, params) }
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

function parseConfiguredKeys(value: string | undefined): string[] {
  if (!value) return []
  return value.split(',').map((key) => key.trim()).filter(Boolean)
}

function stringValue(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}
