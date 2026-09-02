import type { Bindings } from '../env'
import { BarkError } from '../bark/response'
import { buildPayload } from './payload'
import { createApnsToken } from './jwt'
import type { ApnsResponse, PushMessage } from './types'
import {
  BARK_APNS_KEY_ID,
  BARK_APNS_PRIVATE_KEY,
  BARK_APNS_TEAM_ID,
  BARK_APNS_TOPIC,
} from './bark-credentials'

export class ApnsClient {
  constructor(private readonly env: Bindings) {}

  async push(message: PushMessage): Promise<ApnsResponse> {
    const privateKey = this.env.APNS_PRIVATE_KEY || BARK_APNS_PRIVATE_KEY
    const keyId = this.env.APNS_KEY_ID || BARK_APNS_KEY_ID
    const teamId = this.env.APNS_TEAM_ID || BARK_APNS_TEAM_ID
    const token = await this.authorizationToken(privateKey, keyId, teamId)
    const payload = buildPayload(message)
    const host = (this.env.APNS_HOST ?? 'https://api.push.apple.com').replace(/\/$/, '')
    const headers = new Headers({
      authorization: `bearer ${token}`,
      'apns-topic': this.env.APNS_TOPIC ?? BARK_APNS_TOPIC,
      'apns-push-type': payload.pushType,
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 24 * 60 * 60),
      'content-type': 'application/json',
    })
    if (message.id) headers.set('apns-collapse-id', message.id)

    try {
      const response = await fetch(`${host}/3/device/${encodeURIComponent(message.deviceToken)}`, {
        method: 'POST',
        headers,
        body: payload.body,
      })
      return await parseResponse(response)
    } catch (error) {
      throw new BarkError(500, `push failed: ${errorMessage(error)}`)
    }
  }

  private async authorizationToken(privateKey: string, keyId: string, teamId: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    try {
      const row = await this.env.DB
        .prepare('SELECT token, time FROM authorization WHERE id = 1')
        .first<{ token: string; time: number | string }>()
      if (row && now - Number(row.time) <= 3000) return row.token
    } catch {
      // A freshly-created database may be between migrations; signing still works.
    }

    const token = await createApnsToken(privateKey, keyId, teamId)
    try {
      await this.env.DB.prepare(
        `INSERT INTO authorization(id, token, time) VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET token = excluded.token, time = excluded.time`,
      ).bind(token, now).run()
    } catch {
      // D1 caching is an optimization; APNs authentication remains valid without it.
    }
    return token
  }
}

async function parseResponse(response: Response): Promise<ApnsResponse> {
  let reason: string | undefined
  if (!response.ok) {
    const text = await response.text()
    try { reason = (JSON.parse(text) as { reason?: string }).reason }
    catch { reason = text || response.statusText }
  }
  return { status: response.status, reason, apnsId: response.headers.get('apns-id') ?? undefined }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
