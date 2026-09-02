import { Hono, type Context } from 'hono'
import type { AppEnv } from '../../env'
import { McpSessionRepository, type McpSession } from '../../repositories/mcp-session-repository'
import { PushService } from '../push-service'

type JsonRpcRequest = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

const commonProperties = {
  title: { type: 'string', description: 'Notification title' },
  subtitle: { type: 'string', description: 'Notification subtitle' },
  body: { type: 'string', description: 'Notification content' },
  markdown: { type: 'string', description: 'Markdown content, overrides body' },
  level: { type: 'string', description: 'Notification level', enum: ['critical', 'active', 'timeSensitive', 'passive'] },
  volume: { type: 'number', description: 'Alert volume (0–10)', minimum: 0, maximum: 10, default: 5 },
  badge: { type: 'number', description: 'Badge number' },
  call: { type: 'string', description: "Set to '1' to repeat ringtone" },
  sound: { type: 'string', description: 'Notification sound name' },
  icon: { type: 'string', description: 'Notification icon URL' },
  image: { type: 'string', description: 'Notification image URL' },
  group: { type: 'string', description: 'Notification group' },
  isArchive: { type: 'string', description: "Set to '1' to archive, other value to skip" },
  ttl: { type: 'number', description: 'Time to live in seconds for archived messages; expired items are automatically deleted' },
  url: { type: 'string', description: 'Click action URL' },
  copy: { type: 'string', description: 'Text to copy on copy action' },
} as const

export const mcpRoutes = new Hono<AppEnv>()

mcpRoutes.all('/mcp', (c) => handleMcp(c, undefined))
mcpRoutes.all('/mcp/:device_key', (c) => handleMcp(c, c.req.param('device_key')))

async function handleMcp(c: Context<AppEnv>, fixedDeviceKey: string | undefined): Promise<Response> {
  const sessions = new McpSessionRepository(c.env.DB)
  if (c.req.method === 'DELETE') {
    const sessionId = c.req.header('mcp-session-id')
    if (sessionId) await sessions.delete(sessionId)
    return new Response(null, { status: 200 })
  }
  if (c.req.method !== 'POST') return jsonRpcError(null, -32700, 'Method not allowed')

  let request: JsonRpcRequest
  try {
    request = await c.req.json<JsonRpcRequest>()
  } catch {
    return jsonRpcError(null, -32700, 'request body is not valid json')
  }
  const id = request.id ?? null
  if (request.jsonrpc !== '2.0') return jsonRpcError(id, -32600, 'Invalid Request')

  if (request.method === 'initialize') {
    await sessions.cleanup()
    const session = await sessions.create(fixedDeviceKey)
    const response = jsonRpcResult(id, {
      protocolVersion: '2025-03-26',
      capabilities: { tools: { listChanged: true } },
      serverInfo: {
        name: fixedDeviceKey ? 'Bark MCP Server (Specific)' : 'Bark MCP Server',
        version: c.env.APP_VERSION ?? 'dev',
      },
    })
    response.headers.set('mcp-session-id', session.id)
    return response
  }

  const session = await sessions.find(c.req.header('mcp-session-id'))
  if (!session) {
    if (request.method === 'notifications/initialized') return new Response(null, { status: 400 })
    return new Response('Invalid session ID', {
      status: 400,
      headers: { 'content-type': 'text/plain' },
    })
  }
  await sessions.touch(session)

  if (request.method === 'notifications/initialized') return new Response(null, { status: 202 })
  if (request.method === 'ping') return jsonRpcResult(id, {})
  if (request.method === 'tools/list') return toolsList(id, session)
  if (request.method === 'tools/call') return callTool(c, id, request.params, session)
  return jsonRpcError(id, -32601, `Method not found: ${request.method}`)
}

function toolsList(id: JsonRpcRequest['id'], session: McpSession): Response {
  const properties: Record<string, unknown> = { ...commonProperties }
  const required = session.device_key ? [] : ['device_key']
  if (!session.device_key) properties.device_key = { type: 'string', description: 'Device key' }
  return jsonRpcResult(id, {
    tools: [{
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      name: 'notify',
      description: 'Send a notification to a device via Bark',
      inputSchema: {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
      },
    }],
  })
}

async function callTool(
  c: Context<AppEnv>,
  id: JsonRpcRequest['id'],
  params: Record<string, unknown> | undefined,
  session: McpSession,
): Promise<Response> {
  const name = params?.name
  if (name !== 'notify') return jsonRpcError(id, -32602, `tool '${name}' not found: tool not found`)
  const rawArguments = params?.arguments
  const args = isRecord(rawArguments) ? { ...rawArguments } : {}
  const deviceKey = session.device_key || (typeof args.device_key === 'string' ? args.device_key : '')
  if (!deviceKey) return toolResult(id, 'device_key is required', true)
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries({ ...args, device_key: deviceKey })) normalized[key.toLowerCase()] = value
  try {
    await new PushService(c.env).push(normalized)
    return toolResult(id, 'Notification sent successfully', false)
  } catch (error) {
    return toolResult(id, `Failed to send notification: ${error instanceof Error ? error.message : String(error)}`, true)
  }
}

function jsonRpcResult(id: JsonRpcRequest['id'], result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id, result })
}

function jsonRpcError(id: JsonRpcRequest['id'], code: number, message: string): Response {
  return Response.json({ jsonrpc: '2.0', id, error: { code, message } })
}

function toolResult(id: JsonRpcRequest['id'], text: string, isError: boolean): Response {
  return jsonRpcResult(id, {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
