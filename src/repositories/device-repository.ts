import { BarkError } from '../bark/response'

export class DeviceRepository {
  constructor(private readonly db: D1Database) {}

  async count(): Promise<number> {
    const row = await this.db.prepare('SELECT COUNT(*) AS count FROM devices').first<{ count: number }>()
    return Number(row?.count ?? 0)
  }

  async listActiveKeys(): Promise<string[]> {
    const result = await this.db
      .prepare(
        `SELECT MIN(device_key) AS device_key
         FROM devices
         WHERE device_token <> ''
         GROUP BY device_token
         ORDER BY MIN(created_at) ASC`,
      )
      .all<{ device_key: string }>()
    return result.results.map((row) => row.device_key)
  }

  async findToken(deviceKey: string): Promise<string> {
    const normalizedKey = normalizeLookupKey(deviceKey)
    const row = await this.db
      .prepare('SELECT device_token FROM devices WHERE device_key = ?1')
      .bind(normalizedKey)
      .first<{ device_token: string }>()
    if (!row) throw new BarkError(400, `failed to get [${deviceKey}] device token from database`)
    if (!row.device_token) throw new BarkError(400, 'device token invalid')
    return row.device_token
  }

  async findTokens(deviceKeys: string[]): Promise<Map<string, string>> {
    if (deviceKeys.length === 0) return new Map()
    const tokens = new Map<string, string>()
    const normalized = deviceKeys.map(normalizeLookupKey)
    // Stay below D1/SQLite parameter limits even when batch limiting is disabled.
    for (let offset = 0; offset < normalized.length; offset += 90) {
      const chunk = normalized.slice(offset, offset + 90)
      const placeholders = chunk.map((_, index) => `?${index + 1}`).join(',')
      const result = await this.db
        .prepare(`SELECT device_key, device_token FROM devices WHERE device_key IN (${placeholders})`)
        .bind(...chunk)
        .all<{ device_key: string; device_token: string }>()
      const rows = new Map(result.results.map((row) => [row.device_key, row.device_token]))
      for (let index = 0; index < chunk.length; index += 1) {
        const token = rows.get(chunk[index]!)
        if (token !== undefined) tokens.set(deviceKeys[offset + index]!, token)
      }
    }
    return tokens
  }

  async save(deviceKey: string | undefined, deviceToken: string): Promise<string> {
    let key = deviceKey
    if (!key) key = await this.generateKey()
    const timestamp = Math.floor(Date.now() / 1000)
    await this.db
      .prepare(
        `INSERT INTO devices(device_key, device_token, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(device_key) DO UPDATE SET device_token = excluded.device_token, updated_at = excluded.updated_at`,
      )
      .bind(key, deviceToken, timestamp)
      .run()
    return key
  }

  async exists(deviceKey: string): Promise<boolean> {
    const row = await this.db
      .prepare('SELECT 1 AS found FROM devices WHERE device_key = ?1')
      .bind(normalizeLookupKey(deviceKey))
      .first<{ found: number }>()
    return Boolean(row)
  }

  async invalidate(deviceKey: string): Promise<void> {
    await this.db
      .prepare('UPDATE devices SET device_token = ?1, updated_at = ?2 WHERE device_key = ?3')
      .bind('', Math.floor(Date.now() / 1000), deviceKey)
      .run()
  }

  private async generateKey(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const digest = new Uint8Array(await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(crypto.randomUUID()),
      ))
      const key = base64(digest).replace(/[^a-zA-Z0-9]|[lIO01]/g, '').slice(0, 22)
      const exists = await this.db
        .prepare('SELECT 1 AS found FROM devices WHERE device_key = ?1')
        .bind(key)
        .first()
      if (!exists) return key
    }
    throw new BarkError(500, 'failed to generate unique device key')
  }
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function normalizeLookupKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, '') || '_PLACE_HOLDER_'
}
