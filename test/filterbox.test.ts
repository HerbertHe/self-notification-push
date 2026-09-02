import { describe, expect, it } from 'vitest'
import { extractBarkParams } from '../src/filterbox/bark-channel'

describe('FilterBox Bark private parameters', () => {
  it('strips bark_ case-insensitively and ignores generic unknown fields', () => {
    const input = {
      title: 'generic',
      unrelated: 'ignored',
      bark_title: 'private',
      BARK_isArchive: '1',
      bark_autoCopy: '1',
      bark_device_keys: ['a', 'b'],
      bark_future_parameter: 'forwarded',
    }
    expect(extractBarkParams(input)).toEqual({
      title: 'private',
      isarchive: '1',
      autocopy: '1',
      device_keys: ['a', 'b'],
      future_parameter: 'forwarded',
    })
  })
})
