import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { parseDeviceKeys, parsePushRequest } from '../src/bark/parser'

describe('push parser', () => {
  it('lets query override JSON and path override query', async () => {
    const app = new Hono()
    app.post('/:device_key', async (c) => c.json(await parsePushRequest(c, {
      device_key: c.req.param('device_key'),
    })))
    const response = await app.request('/path-key?title=query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_key: 'body-key', title: 'body' }),
    })
    expect(await response.json()).toEqual({ device_key: 'path-key', title: 'query' })
  })

  it('parses both batch key forms', () => {
    expect(parseDeviceKeys({ device_keys: ['a', 'b'] })).toEqual(['a', 'b'])
    expect(parseDeviceKeys({ device_keys: 'a, b' })).toEqual(['a', 'b'])
  })
})
