import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../src/app'
import type { Bindings } from '../src/env'

class FakeD1 {
  readonly devices = new Map<string, string>()
  readonly sessions = new Map<string, { id: string; device_key: string | null; initialized: number }>()
  readonly sourceKeys = new Map<string, { key: string; remark: string; created_at: number; updated_at: number }>()

  prepare(sql: string) {
    let args: unknown[] = []
    const statement = {
      bind: (...values: unknown[]) => {
        args = values
        return statement
      },
      first: async <T>() => {
        if (sql.includes('COUNT(*)')) return { count: this.devices.size } as T
        if (sql.includes('SELECT 1 AS found FROM source_keys')) {
          return (this.sourceKeys.has(String(args[0])) ? { found: 1 } : null) as T
        }
        if (sql.includes('FROM source_keys WHERE key')) {
          return (this.sourceKeys.get(String(args[0])) ?? null) as T
        }
        if (sql.includes('SELECT 1')) return (this.devices.has(String(args[0])) ? { found: 1 } : null) as T
        if (sql.includes('SELECT device_token')) {
          const token = this.devices.get(String(args[0]))
          return (token === undefined ? null : { device_token: token }) as T
        }
        if (sql.includes('SELECT id, device_key, initialized FROM sessions')) {
          return (this.sessions.get(String(args[0])) ?? null) as T
        }
        return null
      },
      all: async <T>() => {
        if (sql.includes('FROM source_keys')) {
          return {
            results: [...this.sourceKeys.values()].sort((a, b) => b.created_at - a.created_at) as T[],
            success: true,
            meta: {},
          }
        }
        if (sql.includes("WHERE device_token <> ''") && sql.includes('GROUP BY device_token')) {
          const keysByToken = new Map<string, string>()
          for (const [deviceKey, deviceToken] of this.devices) {
            if (deviceToken && !keysByToken.has(deviceToken)) keysByToken.set(deviceToken, deviceKey)
          }
          return {
            results: [...keysByToken.values()].map((device_key) => ({ device_key })) as T[],
            success: true,
            meta: {},
          }
        }
        return {
          results: [...this.devices.entries()]
            .filter(([key]) => args.map(String).includes(key))
            .map(([device_key, device_token]) => ({ device_key, device_token })) as T[],
          success: true,
          meta: {},
        }
      },
      run: async () => {
        let changes = 0
        if (sql.includes('INSERT INTO devices')) this.devices.set(String(args[0]), String(args[1]))
        if (sql.includes('UPDATE devices SET device_token')) this.devices.set(String(args[2]), String(args[0]))
        if (sql.includes('INSERT INTO sessions')) {
          this.sessions.set(String(args[0]), {
            id: String(args[0]),
            device_key: args[1] === null ? null : String(args[1]),
            initialized: 1,
          })
        }
        if (sql.includes('DELETE FROM sessions WHERE id')) this.sessions.delete(String(args[0]))
        if (sql.includes('INSERT INTO source_keys')) {
          const key = String(args[0])
          if (this.sourceKeys.has(key)) throw new Error('UNIQUE constraint failed: source_keys.key')
          this.sourceKeys.set(key, {
            key,
            remark: String(args[1]),
            created_at: Number(args[2]),
            updated_at: Number(args[2]),
          })
          changes = 1
        }
        if (sql.includes('UPDATE source_keys')) {
          const currentKey = String(args[3])
          const current = this.sourceKeys.get(currentKey)
          if (current) {
            const nextKey = String(args[0])
            if (nextKey !== currentKey && this.sourceKeys.has(nextKey)) {
              throw new Error('UNIQUE constraint failed: source_keys.key')
            }
            this.sourceKeys.delete(currentKey)
            this.sourceKeys.set(nextKey, {
              ...current,
              key: nextKey,
              remark: String(args[1]),
              updated_at: Number(args[2]),
            })
            changes = 1
          }
        }
        if (sql.includes('DELETE FROM source_keys')) {
          changes = this.sourceKeys.delete(String(args[0])) ? 1 : 0
        }
        return { success: true, meta: { changes } }
      },
    }
    return statement
  }
}

let privateKeyPem = ''

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const bytes = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${btoa(binary)}\n-----END PRIVATE KEY-----`
})

describe('Bark Worker routes', () => {
  let database: FakeD1
  let env: Bindings

  beforeEach(() => {
    database = new FakeD1()
    env = {
      DB: database as unknown as D1Database,
      APNS_PRIVATE_KEY: privateKeyPem,
      APNS_KEY_ID: 'ABCDEFGHIJ',
      APNS_TEAM_ID: 'TEAM123456',
      APNS_TOPIC: 'me.fin.bark',
      APNS_HOST: 'https://apns.example.test',
      MAX_BATCH_PUSH_COUNT: '10',
      APP_VERSION: 'test',
      FILTERBOX_DEFAULT_CHANNEL: 'bark',
      BACKDOOR_API_KEY: 'admin-secret',
    }
    database.sourceKeys.set('filterbox-source-key-123', {
      key: 'filterbox-source-key-123',
      remark: 'FilterBox',
      created_at: 1,
      updated_at: 1,
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {
      status: 200,
      headers: { 'apns-id': 'test-id' },
    })))
  })

  it('serves health endpoints', async () => {
    expect(await (await app.request('/bark', undefined, env)).text()).toBe('ok')
    const ping = await (await app.request('/bark/ping', undefined, env)).json<{ message: string }>()
    expect(ping.message).toBe('pong')
  })

  it('registers, checks and pushes with a legacy URL', async () => {
    const registration = await app.request('/bark/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_key: 'my-key', device_token: 'apns-token' }),
    }, env)
    expect(registration.status).toBe(200)
    const registrationBody = await registration.json<{ data: { device_key: string } }>()
    const registeredKey = registrationBody.data.device_key
    expect(registeredKey).toHaveLength(22)
    expect(registeredKey).not.toMatch(/[lIO01]/)
    expect(database.devices.get(registeredKey)).toBe('apns-token')
    expect((await app.request(`/bark/register/${registeredKey}`, undefined, env)).status).toBe(200)

    const response = await app.request(`/bark/${registeredKey}/Hello`, undefined, env)
    expect(response.status).toBe(200)
    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0]!
    const payload = JSON.parse(String(init?.body))
    expect(payload.aps.alert.body).toBe('Hello')
  })

  it('matches the Bark App GET registration contract', async () => {
    const first = await app.request(
      '/bark/register?key=&devicetoken=abcdef0123456789',
      undefined,
      env,
    )
    expect(first.status).toBe(200)
    const firstBody = await first.json<{ data: { key: string; device_key: string; device_token: string } }>()
    expect(firstBody.data.key).toBe(firstBody.data.device_key)
    expect(firstBody.data.device_token).toBe('abcdef0123456789')

    const second = await app.request(
      `/bark/register?key=${firstBody.data.key}&devicetoken=fedcba9876543210`,
      undefined,
      env,
    )
    const secondBody = await second.json<{ data: { key: string } }>()
    expect(secondBody.data.key).toBe(firstBody.data.key)
    expect(database.devices.get(firstBody.data.key)).toBe('fedcba9876543210')
  })

  it('returns ordered partial results for batch pushes', async () => {
    database.devices.set('known', 'token')
    const response = await app.request('/bark/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_keys: ['known', 'missing', ''], body: 'test' }),
    }, env)
    const body = await response.json<{ data: Array<{ code: number; device_key: string }> }>()
    expect(body.data).toEqual([
      { code: 200, device_key: 'known' },
      expect.objectContaining({ code: 400, device_key: 'missing' }),
      { code: 400, device_key: '', message: 'device key is empty' },
    ])

    const legacyJson = await app.request('/bark/path-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_keys: ['known'], body: 'legacy JSON batch' }),
    }, env)
    const legacyBody = await legacyJson.json<{ data: Array<{ device_key: string }> }>()
    expect(legacyBody.data).toEqual([{ code: 200, device_key: 'known' }])
  })

  it('invalidates rejected APNs device tokens', async () => {
    database.devices.set('invalid', 'bad-token')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(
      { reason: 'BadDeviceToken' },
      { status: 400 },
    )))
    const response = await app.request('/bark/invalid/test', undefined, env)
    expect(response.status).toBe(500)
    expect(database.devices.get('invalid')).toBe('')
    expect((await app.request('/bark/register/invalid', undefined, env)).status).toBe(400)
  })

  it('enforces auth except for register and health routes', async () => {
    env.BASIC_AUTH_USER = 'user'
    env.BASIC_AUTH_PASSWORD = 'pass'
    expect((await app.request('/bark/ping', undefined, env)).status).toBe(200)
    expect((await app.request('/bark/info', undefined, env)).status).toBe(401)
    const authorized = await app.request('/bark/info', {
      headers: { authorization: `Basic ${btoa('user:pass')}` },
    }, env)
    expect(authorized.status).toBe(200)

    delete env.BASIC_AUTH_USER
    delete env.BASIC_AUTH_PASSWORD
    env.BASIC_AUTH = 'combined:secret'
    const combined = await app.request('/bark/info', {
      headers: { authorization: `Basic ${btoa('combined:secret')}` },
    }, env)
    expect(combined.status).toBe(200)
    expect(combined.headers.get('server')).toBe('Bark')
  })

  it('uses Bark public APNs provider configuration when secrets are absent', async () => {
    database.devices.set('official', 'token')
    delete env.APNS_PRIVATE_KEY
    delete env.APNS_KEY_ID
    delete env.APNS_TEAM_ID
    const response = await app.request('/bark/official/official-app?id=collapse-id', undefined, env)
    expect(response.status).toBe(200)
    const [, init] = vi.mocked(fetch).mock.calls[0]!
    expect(new Headers(init?.headers).get('apns-topic')).toBe('me.fin.bark')
    expect(new Headers(init?.headers).get('authorization')).toMatch(/^bearer /)
    expect(new Headers(init?.headers).get('apns-collapse-id')).toBe('collapse-id')
    expect(new Headers(init?.headers).has('apns-priority')).toBe(false)
  })

  it('implements MCP initialize and tools/list', async () => {
    const initialize = await app.request('/bark/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }),
    }, env)
    expect((await initialize.clone().json<{ result: { serverInfo: { name: string } } }>()).result.serverInfo.name).toBe('Bark MCP Server')
    const genericSession = initialize.headers.get('mcp-session-id')!

    const list = await app.request('/bark/mcp/device', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'initialize' }),
    }, env)
    const specificSession = list.headers.get('mcp-session-id')!
    const initialized = await app.request('/bark/mcp/device', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'mcp-session-id': specificSession },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    }, env)
    expect(initialized.status).toBe(202)
    const tools = await app.request('/bark/mcp/device', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'mcp-session-id': specificSession },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    }, env)
    const listBody = await tools.json<{ result: { tools: Array<{ inputSchema: { required?: string[] } }> } }>()
    expect(listBody.result.tools[0]!.inputSchema.required).toBeUndefined()

    database.devices.set('device', 'token')
    const call = await app.request('/bark/mcp/device', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'mcp-session-id': specificSession },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'notify', arguments: { body: 'MCP test' } },
      }),
    }, env)
    const callBody = await call.json<{ result: { isError: boolean } }>()
    expect(callBody.result.isError).toBeUndefined()

    const invalidSession = await app.request('/bark/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'mcp-session-id': `${genericSession}-invalid` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/list' }),
    }, env)
    expect(invalidSession.status).toBe(400)

    const deleted = await app.request('/bark/mcp/device', {
      method: 'DELETE',
      headers: { 'mcp-session-id': specificSession },
    }, env)
    expect(deleted.status).toBe(200)
    expect(database.sessions.has(specificSession)).toBe(false)
  })

  it('accepts FilterBox JSON and maps generic and bark_ parameters', async () => {
    database.devices.set('fbdefault', 'token')
    const response = await app.request('/filterbox/webhook?channel=bark', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer filterbox-source-key-123',
      },
      body: JSON.stringify({
        channel: 'unsupported-body-value',
        title: 'Android title',
        body: 'Android body',
        app_name: 'Messages',
        bark_group: 'filterbox',
        bark_sound: 'minuet',
        bark_custom_field: 'custom',
      }),
    }, env)
    expect(response.status).toBe(200)
    const [, init] = vi.mocked(fetch).mock.calls[0]!
    const payload = JSON.parse(String(init?.body))
    expect(payload.aps.alert).toEqual({ title: 'Android title', body: 'Android body' })
    expect(payload.aps.sound).toBe('minuet.caf')
    expect(payload.aps['thread-id']).toBe('filterbox')
    expect(payload.custom_field).toBe('custom')
    expect(payload.app_name).toBeUndefined()
  })

  it('supports FilterBox GET, form, explicit keys and batch keys', async () => {
    database.devices.set('one', 'token-one')
    database.devices.set('two', 'token-two')
    const getResponse = await app.request(
      '/filterbox/webhook?channel=bark&title=GET&body=message&bark_device_key=one',
      { headers: { authorization: 'Bearer filterbox-source-key-123' } },
      env,
    )
    expect(getResponse.status).toBe(200)

    const formResponse = await app.request('/filterbox/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: 'Bearer filterbox-source-key-123',
      },
      body: 'channel=bark&title=Form&body=message&bark_device_key=one',
    }, env)
    expect(formResponse.status).toBe(200)

    const batchResponse = await app.request('/filterbox/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer filterbox-source-key-123',
      },
      body: JSON.stringify({
        channel: 'bark', body: 'batch', bark_device_keys: ['one', 'two'],
      }),
    }, env)
    const batch = await batchResponse.json<{ data: Array<{ code: number; device_key: string }> }>()
    expect(batch.data).toEqual([
      { code: 200, device_key: 'one' },
      { code: 200, device_key: 'two' },
    ])
  })

  it('pushes FilterBox notifications to every active device when no target is specified', async () => {
    database.devices.set('first', 'token-first')
    database.devices.set('second', 'token-second')
    database.devices.set('old-key-for-first', 'token-first')
    database.devices.set('invalid', '')

    const response = await app.request('/filterbox/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer filterbox-source-key-123',
      },
      body: JSON.stringify({ title: 'All devices', body: 'broadcast' }),
    }, env)

    expect(response.status).toBe(200)
    const body = await response.json<{ data: { total: number; succeeded: number; failed: number } }>()
    expect(body.data).toEqual({ total: 2, succeeded: 2, failed: 0 })
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
  })

  it('protects FilterBox webhook and rejects unknown channels', async () => {
    expect((await app.request('/filterbox/ping', undefined, env)).status).toBe(200)
    expect((await app.request('/filterbox/webhook?channel=bark', undefined, env)).status).toBe(401)
    const unsupported = await app.request('/filterbox/webhook?channel=telegram', {
      headers: { authorization: 'Bearer filterbox-source-key-123' },
    }, env)
    expect(unsupported.status).toBe(400)
    expect((await unsupported.json<{ message: string }>()).message).toBe('unsupported channel: telegram')
  })

  it('manages source whitelist keys through the protected backdoor API', async () => {
    database.devices.set('fbdefault', 'token')
    expect((await app.request('/backdoor/keys', undefined, env)).status).toBe(401)
    expect((await app.request('/backdoor/keys', {
      headers: { authorization: 'Bearer wrong-secret' },
    }, env)).status).toBe(401)

    const created = await app.request('/backdoor/keys', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer admin-secret',
      },
      body: JSON.stringify({ remark: 'Home FilterBox' }),
    }, env)
    expect(created.status).toBe(201)
    const createdBody = await created.json<{ data: { key: string; remark: string } }>()
    expect(createdBody.data.key).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(createdBody.data.remark).toBe('Home FilterBox')

    const list = await app.request('/backdoor/keys', {
      headers: { authorization: 'Bearer admin-secret' },
    }, env)
    const listBody = await list.json<{ data: Array<{ key: string; remark: string }> }>()
    expect(listBody.data).toContainEqual(createdBody.data)

    const renamedKey = 'renamed-source-key-1234'
    const patched = await app.request(`/backdoor/keys/${createdBody.data.key}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer admin-secret',
      },
      body: JSON.stringify({ key: renamedKey, remark: 'Renamed source' }),
    }, env)
    expect((await patched.json<{ data: { key: string; remark: string } }>()).data).toEqual({
      key: renamedKey,
      remark: 'Renamed source',
    })
    expect((await app.request(`/backdoor/keys/${createdBody.data.key}`, {
      headers: { authorization: 'Bearer admin-secret' },
    }, env)).status).toBe(404)
    expect((await app.request(`/backdoor/keys/${renamedKey}`, {
      headers: { authorization: 'Bearer admin-secret' },
    }, env)).status).toBe(200)

    const authorizedWebhook = await app.request('/filterbox/webhook?body=whitelisted', {
      headers: { authorization: `Bearer ${renamedKey}` },
    }, env)
    expect(authorizedWebhook.status).toBe(200)

    const removed = await app.request(`/backdoor/keys/${renamedKey}`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer admin-secret' },
    }, env)
    expect(removed.status).toBe(200)
    expect((await app.request('/filterbox/webhook?body=revoked', {
      headers: { authorization: `Bearer ${renamedKey}` },
    }, env)).status).toBe(401)
  })

  it('disables the backdoor without its admin secret and keeps source keys separate from Bark keys', async () => {
    delete env.BACKDOOR_API_KEY
    expect((await app.request('/backdoor/keys', undefined, env)).status).toBe(404)

    const sourceKey = 'filterbox-source-key-123'
    expect(database.sourceKeys.has(sourceKey)).toBe(true)
    expect(database.devices.has(sourceKey)).toBe(false)
    expect((await app.request(`/bark/register/${sourceKey}`, undefined, env)).status).toBe(400)
  })
})
