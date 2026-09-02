import { Hono, type Context } from 'hono'
import type { AppEnv } from '../env'
import { BarkError, success } from '../bark/response'
import { SourceKeyRepository, type SourceKey } from '../repositories/source-key-repository'
import { backdoorAuth } from './auth'

type KeyView = Pick<SourceKey, 'key' | 'remark'>

export const backdoorApp = new Hono<AppEnv>()

backdoorApp.use('*', backdoorAuth)

backdoorApp.get('/keys', async (c) => {
  const records = await new SourceKeyRepository(c.env.DB).list()
  return c.json(success(records.map(toView)))
})

backdoorApp.post('/keys', async (c) => {
  const input = await jsonObject(c)
  assertFields(input, ['key', 'remark'])
  const key = optionalString(input.key, 'key')
  const remark = optionalString(input.remark, 'remark') ?? ''
  const record = await new SourceKeyRepository(c.env.DB).create(key, remark)
  return c.json(success(toView(record)), 201)
})

backdoorApp.get('/keys/:key', async (c) => {
  const record = await new SourceKeyRepository(c.env.DB).find(pathKey(c))
  if (!record) throw new BarkError(404, 'source key not found')
  return c.json(success(toView(record)))
})

const updateKey = async (c: Context<AppEnv>) => {
  const repository = new SourceKeyRepository(c.env.DB)
  const currentKey = pathKey(c)
  const current = await repository.find(currentKey)
  if (!current) throw new BarkError(404, 'source key not found')

  const input = await jsonObject(c)
  assertFields(input, ['key', 'remark'])
  if (!Object.hasOwn(input, 'key') && !Object.hasOwn(input, 'remark')) {
    throw new BarkError(400, 'key or remark is required')
  }
  const nextKey = optionalString(input.key, 'key') ?? current.key
  const remark = optionalString(input.remark, 'remark') ?? current.remark
  const updated = await repository.update(currentKey, nextKey, remark)
  return c.json(success(toView(updated)))
}

backdoorApp.put('/keys/:key', updateKey)
backdoorApp.patch('/keys/:key', updateKey)

backdoorApp.delete('/keys/:key', async (c) => {
  const key = pathKey(c)
  await new SourceKeyRepository(c.env.DB).delete(key)
  return c.json(success({ key }))
})

function toView(record: SourceKey): KeyView {
  return { key: record.key, remark: record.remark }
}

function pathKey(c: Context<AppEnv>): string {
  const key = c.req.param('key')
  if (!key) throw new BarkError(400, 'key is required')
  return key
}

async function jsonObject(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  if (!c.req.header('content-type')?.toLowerCase().includes('application/json')) {
    throw new BarkError(400, 'Content-Type must be application/json')
  }
  let value: unknown
  try { value = await c.req.json() }
  catch (error) { throw new BarkError(400, `request bind failed: ${messageOf(error)}`) }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BarkError(400, 'request bind failed: JSON body must be an object')
  }
  return value as Record<string, unknown>
}

function assertFields(input: Record<string, unknown>, allowed: string[]): void {
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key))
  if (unknown.length) throw new BarkError(400, `unsupported field: ${unknown[0]}`)
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new BarkError(400, `${name} must be a string`)
  return value
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
