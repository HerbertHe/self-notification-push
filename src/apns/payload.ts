import { BarkError } from '../bark/response'
import type { ApnsPayload, PushMessage } from './types'

const encoder = new TextEncoder()

export function messageFromParams(params: Record<string, unknown>): Omit<PushMessage, 'deviceToken'> {
  const ext: Record<string, unknown> = {}
  let id: string | undefined
  let deviceKey = ''
  let title = ''
  let subtitle = ''
  let body = ''
  let sound = '1107'

  for (const [rawKey, value] of Object.entries(params)) {
    const key = rawKey.toLowerCase()
    if (typeof value === 'string') {
      switch (key) {
        case 'id':
          id = value
          ext.id = value
          break
        case 'device_key':
          deviceKey = value
          break
        case 'title':
          title = value
          break
        case 'subtitle':
          subtitle = value
          break
        case 'body':
          body = value
          break
        case 'sound':
          sound = value.endsWith('.caf') ? value : `${value}.caf`
          break
        default:
          ext[key] = value
      }
    } else if (isRecord(value)) {
      for (const [nestedKey, nestedValue] of Object.entries(value)) ext[nestedKey.toLowerCase()] = nestedValue
    } else {
      ext[key] = value
    }
  }

  if (!deviceKey) throw new BarkError(400, 'device key is empty')
  if (!title && !subtitle && !body) body = 'Empty Message'
  return { id, deviceKey, title, subtitle, body, sound, ext }
}

export function buildPayload(message: PushMessage): { body: string; pushType: 'alert' | 'background' } {
  const isDelete = message.ext.delete === '1' || message.ext.delete === 1
  const aps: Record<string, unknown> = { 'mutable-content': 1 }
  let pushType: 'alert' | 'background' = 'alert'

  if (isDelete) {
    aps['content-available'] = 1
    pushType = 'background'
  } else {
    const alert: Record<string, string> = {}
    if (message.title) alert.title = message.title
    if (message.subtitle) alert.subtitle = message.subtitle
    if (message.body) alert.body = message.body
    aps.alert = alert
    aps.sound = message.sound
    aps.category = 'myNotificationCategory'
    if (message.ext.group !== undefined) aps['thread-id'] = String(message.ext.group)
  }

  const payload: ApnsPayload = { aps }
  for (const [key, value] of Object.entries(message.ext)) payload[key.toLowerCase()] = stringifyExtension(value)
  const body = JSON.stringify(payload)
  if (encoder.encode(body).byteLength > 4096) throw new BarkError(400, 'notification payload exceeds 4096 bytes')
  return { body, pushType }
}

function stringifyExtension(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null) return '<nil>'
  if (Array.isArray(value)) return `[${value.map(stringifyExtension).join(' ')}]`
  if (typeof value === 'object') {
    return `map[${Object.entries(value as Record<string, unknown>)
      .map(([key, nested]) => `${key}:${stringifyExtension(nested)}`)
      .join(' ')}]`
  }
  return String(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
