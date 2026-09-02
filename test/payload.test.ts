import { describe, expect, it } from 'vitest'
import { buildPayload, messageFromParams } from '../src/apns/payload'

describe('Bark APNs payload', () => {
  it('maps alert fields, sound, group and extension values', () => {
    const base = messageFromParams({
      device_key: 'device',
      title: 'Title',
      subtitle: 'Subtitle',
      body: 'Body',
      sound: 'minuet',
      group: 'ops',
      badge: 3,
      isarchive: '1',
    })
    const result = buildPayload({ ...base, deviceToken: 'token' })
    const payload = JSON.parse(result.body)
    expect(result.pushType).toBe('alert')
    expect(payload.aps).toEqual({
      alert: { title: 'Title', subtitle: 'Subtitle', body: 'Body' },
      sound: 'minuet.caf',
      category: 'myNotificationCategory',
      'thread-id': 'ops',
      'mutable-content': 1,
    })
    expect(payload.badge).toBe('3')
    expect(payload.isarchive).toBe('1')
  })

  it('creates background delete pushes', () => {
    const base = messageFromParams({ device_key: 'device', delete: 1 })
    const result = buildPayload({ ...base, deviceToken: 'token' })
    const payload = JSON.parse(result.body)
    expect(result.pushType).toBe('background')
    expect(payload.aps).toEqual({ 'mutable-content': 1, 'content-available': 1 })
  })

  it('keeps every Bark App extension as a string', () => {
    const base = messageFromParams({
      device_key: 'device',
      body: 'Body',
      call: 1,
      isArchive: 1,
      icon: 'https://example.com/icon.png',
      image: 'https://example.com/image.png',
      ciphertext: 'cipher',
      iv: 'iv',
      level: 'critical',
      volume: 8,
      url: 'https://example.com',
      copy: 'copy-me',
      autoCopy: 1,
      automaticallyCopy: 1,
      action: 'none',
      id: 'collapse-id',
      markdown: '**markdown**',
      ttl: 3600,
    })
    const payload = JSON.parse(buildPayload({ ...base, deviceToken: 'token' }).body)
    for (const key of [
      'call', 'isarchive', 'icon', 'image', 'ciphertext', 'iv', 'level',
      'volume', 'url', 'copy', 'autocopy', 'automaticallycopy', 'action',
      'id', 'markdown', 'ttl',
    ]) expect(typeof payload[key]).toBe('string')
  })

  it('uses Empty Message and rejects oversized payloads', () => {
    const base = messageFromParams({ device_key: 'device' })
    expect(base.body).toBe('Empty Message')
    expect(base.sound).toBe('1107')
    const emptyPayload = JSON.parse(buildPayload({ ...base, deviceToken: 'token' }).body)
    expect(emptyPayload.aps.alert).toEqual({ body: 'Empty Message' })
    const large = messageFromParams({ device_key: 'device', body: 'x'.repeat(5000) })
    expect(() => buildPayload({ ...large, deviceToken: 'token' })).toThrow('4096')
  })
})
