import type { Context } from 'hono'
import { BarkError } from './response'

export type PushParams = Record<string, unknown>

export async function parsePushRequest(
  c: Context,
  pathParams: Record<string, string | undefined> = {},
): Promise<PushParams> {
  const contentType = c.req.header('content-type')?.toLowerCase() ?? ''
  const params: PushParams = {}

  if (isJsonContentType(contentType)) {
    const text = await c.req.text()
    if (text.trim()) {
      let body: unknown
      try {
        body = JSON.parse(text)
      } catch (error) {
        throw new BarkError(400, `request bind failed: ${messageOf(error)}`)
      }
      if (!isRecord(body)) throw new BarkError(400, 'request bind failed: JSON body must be an object')
      assignNormalized(params, body)
    }
    assignQuery(params, c.req.url)
  } else {
    assignQuery(params, c.req.url)
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      try {
        const body = await c.req.parseBody({ all: true })
        for (const [key, value] of Object.entries(body)) {
          params[key.toLowerCase()] = Array.isArray(value) ? value[0] : value
        }
      } catch (error) {
        throw new BarkError(400, `request bind failed: ${messageOf(error)}`)
      }
    }
  }

  for (const [key, value] of Object.entries(pathParams)) {
    if (value !== undefined && value !== '') params[key] = decodePathValue(value)
  }
  return params
}

export function parseDeviceKeys(params: PushParams): string[] {
  const value = params.device_keys
  delete params.device_keys
  if (value === undefined || value === null) return []
  if (typeof value === 'string') {
    let decoded: string
    try { decoded = decodeURIComponent(value).trim() }
    catch (error) { throw new BarkError(400, `request bind failed: ${messageOf(error)}`) }
    if (decoded.startsWith('[') || decoded.endsWith(']')) {
      try {
        const parsed: unknown = JSON.parse(decoded)
        if (Array.isArray(parsed)) return parsed.map(String)
        if (typeof parsed === 'string') return [parsed]
        throw new Error('device_keys JSON must be an array or string')
      } catch (error) {
        throw new BarkError(400, `request bind failed: ${messageOf(error)}`)
      }
    }
    return decoded.split(',').map((key) => key.replace(/['"]/g, '').trim())
  }
  if (Array.isArray(value)) return value.map(String).map((key) => key.trim())
  throw new BarkError(400, 'invalid type for device_keys')
}

export async function parseRegistration(c: Context): Promise<{
  deviceKey?: string
  deviceToken: string
}> {
  const contentType = c.req.header('content-type')?.toLowerCase() ?? ''
  const values: Record<string, unknown> = {}
  if (c.req.method === 'GET') {
    assignQuery(values, c.req.url)
  } else if (isJsonContentType(contentType)) {
    let body: unknown
    try {
      body = await c.req.json()
    } catch (error) {
      throw new BarkError(400, `request bind failed: ${messageOf(error)}`)
    }
    if (!isRecord(body)) throw new BarkError(400, 'request bind failed: body must be an object')
    assignNormalized(values, body)
  } else if (contentType.includes('application/xml') || contentType.includes('text/xml')) {
    const body = await c.req.text()
    for (const field of ['device_key', 'device_token', 'key', 'devicetoken']) {
      const match = body.match(new RegExp(`<${field}>([\\s\\S]*?)</${field}>`, 'i'))
      if (match?.[1] !== undefined) values[field] = decodeXml(match[1])
    }
  } else {
    const body = await c.req.parseBody({ all: true })
    assignNormalized(values, body)
  }

  const deviceKey = stringValue(values.device_key ?? values.key)
  const deviceToken = stringValue(values.device_token ?? values.devicetoken)
  if (!deviceToken) throw new BarkError(400, 'device token is empty')
  if (deviceToken.length > 160) throw new BarkError(400, 'device token is invalid')
  return { deviceKey: deviceKey || undefined, deviceToken }
}

function assignNormalized(target: PushParams, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) target[key.toLowerCase()] = value
}

function assignQuery(target: PushParams, url: string): void {
  for (const [key, value] of new URL(url).searchParams) target[key.toLowerCase()] = value
}

function decodePathValue(value: string): string {
  if (!value.includes('%')) return value
  try {
    return decodeURIComponent(value)
  } catch (error) {
    throw new BarkError(400, `url path parse failed: ${messageOf(error)}`)
  }
}

function stringValue(value: unknown): string {
  if (Array.isArray(value)) return value.length ? String(value[0]) : ''
  return value === undefined || value === null ? '' : String(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function isJsonContentType(contentType: string): boolean {
  const mediaType = contentType.split(';', 1)[0]?.trim() ?? ''
  return mediaType === 'application/json' || mediaType.endsWith('+json')
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}
