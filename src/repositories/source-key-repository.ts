import { BarkError } from '../bark/response'

export type SourceKey = {
  key: string
  remark: string
  created_at: number
  updated_at: number
}

export class SourceKeyRepository {
  constructor(private readonly db: D1Database) {}

  async list(): Promise<SourceKey[]> {
    const result = await this.db.prepare(
      'SELECT key, remark, created_at, updated_at FROM source_keys ORDER BY created_at DESC',
    ).all<SourceKey>()
    return result.results
  }

  async find(key: string): Promise<SourceKey | null> {
    return await this.db.prepare(
      'SELECT key, remark, created_at, updated_at FROM source_keys WHERE key = ?1',
    ).bind(key).first<SourceKey>()
  }

  async exists(key: string): Promise<boolean> {
    if (!key) return false
    const row = await this.db.prepare(
      'SELECT 1 AS found FROM source_keys WHERE key = ?1',
    ).bind(key).first<{ found: number }>()
    return Boolean(row)
  }

  async create(key: string | undefined, remark: string): Promise<SourceKey> {
    const value = key || generateSourceKey()
    validateSourceKey(value)
    validateRemark(remark)
    const now = Math.floor(Date.now() / 1000)
    try {
      await this.db.prepare(
        'INSERT INTO source_keys(key, remark, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)',
      ).bind(value, remark, now).run()
    } catch (error) {
      throw new BarkError(409, `source key already exists or cannot be created: ${messageOf(error)}`)
    }
    return { key: value, remark, created_at: now, updated_at: now }
  }

  async update(currentKey: string, nextKey: string, remark: string): Promise<SourceKey> {
    validateSourceKey(nextKey)
    validateRemark(remark)
    const now = Math.floor(Date.now() / 1000)
    let result: D1Result
    try {
      result = await this.db.prepare(
        'UPDATE source_keys SET key = ?1, remark = ?2, updated_at = ?3 WHERE key = ?4',
      ).bind(nextKey, remark, now, currentKey).run()
    } catch (error) {
      throw new BarkError(409, `source key already exists or cannot be updated: ${messageOf(error)}`)
    }
    if ((result.meta.changes ?? 0) === 0) throw new BarkError(404, 'source key not found')
    const created = await this.find(nextKey)
    if (!created) throw new BarkError(500, 'failed to read updated source key')
    return created
  }

  async delete(key: string): Promise<void> {
    const result = await this.db.prepare('DELETE FROM source_keys WHERE key = ?1').bind(key).run()
    if ((result.meta.changes ?? 0) === 0) throw new BarkError(404, 'source key not found')
  }
}

function generateSourceKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function validateSourceKey(key: string): void {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) {
    throw new BarkError(400, 'key must be 16-128 URL-safe characters')
  }
}

function validateRemark(remark: string): void {
  if (remark.length > 200) throw new BarkError(400, 'remark must not exceed 200 characters')
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
