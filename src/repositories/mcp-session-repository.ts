export type McpSession = {
  id: string
  device_key: string | null
  initialized: number
}

export class McpSessionRepository {
  constructor(private readonly db: D1Database) {}

  async create(deviceKey?: string): Promise<McpSession> {
    const id = `mcp-session-${crypto.randomUUID()}`
    const now = Math.floor(Date.now() / 1000)
    await this.db.prepare(
      `INSERT INTO sessions(id, device_key, initialized, created_at, last_seen)
       VALUES (?1, ?2, 1, ?3, ?3)`,
    ).bind(id, deviceKey || null, now).run()
    return { id, device_key: deviceKey || null, initialized: 1 }
  }

  async find(id: string | undefined): Promise<McpSession | null> {
    if (!id) return null
    const now = Math.floor(Date.now() / 1000)
    return await this.db.prepare(
      `SELECT id, device_key, initialized FROM sessions
       WHERE id = ?1 AND last_seen > ?2 AND created_at > ?3`,
    ).bind(id, now - 3600, now - 86400).first<McpSession>()
  }

  async touch(session: McpSession): Promise<void> {
    await this.db.prepare(
      'UPDATE sessions SET initialized = 1, last_seen = ?1 WHERE id = ?2',
    ).bind(Math.floor(Date.now() / 1000), session.id).run()
  }

  async delete(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM sessions WHERE id = ?1').bind(id).run()
  }

  async cleanup(): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    await this.db.prepare(
      'DELETE FROM sessions WHERE last_seen < ?1 OR created_at < ?2',
    ).bind(now - 3600, now - 86400).run()
  }
}
