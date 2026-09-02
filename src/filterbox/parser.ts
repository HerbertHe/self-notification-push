import type { Context } from 'hono'
import { BarkError } from '../bark/response'
import { isJsonContentType } from '../bark/parser'

const MAX_BODY_BYTES = 64 * 1024

export async function parseFilterBoxRequest(c: Context): Promise<Record<string, unknown>> {
  const input: Record<string, unknown> = {}
  const length = Number(c.req.header('content-length') ?? 0)
  if (length > MAX_BODY_BYTES) throw new BarkError(413, 'request body exceeds 65536 bytes')

  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const text = await c.req.text()
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      throw new BarkError(413, 'request body exceeds 65536 bytes')
    }
    if (text.trim()) parseBody(input, text, c.req.header('content-type')?.toLowerCase() ?? '')
  }

  // Query parameters intentionally override body values, especially channel.
  for (const [key, value] of new URL(c.req.url).searchParams) input[key.toLowerCase()] = value
  return input
}

export function genericTitle(input: Record<string, unknown>): string {
  return stringValue(input.title)
}

export function genericBody(input: Record<string, unknown>): string {
  return stringValue(input.body ?? input.text ?? input.message)
}

function parseBody(target: Record<string, unknown>, text: string, contentType: string): void {
  if (isJsonContentType(contentType) || (!contentType && text.trimStart().startsWith('{'))) {
    let value: unknown
    try { value = JSON.parse(text) }
    catch (error) { throw new BarkError(400, `request bind failed: ${messageOf(error)}`) }
    if (!isRecord(value)) throw new BarkError(400, 'request bind failed: JSON body must be an object')
    for (const [key, item] of Object.entries(value)) target[key.toLowerCase()] = item
    return
  }

  if (contentType.includes('application/x-www-form-urlencoded') || !contentType) {
    for (const [key, value] of new URLSearchParams(text)) target[key.toLowerCase()] = value
    return
  }
  throw new BarkError(400, `unsupported content type: ${contentType || 'unknown'}`)
}

function stringValue(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
