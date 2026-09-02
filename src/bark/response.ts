import type { Context } from 'hono'

export type CommonResponse<T = unknown> = {
  code: number
  message: string
  data?: T
  timestamp: number
}

export const now = () => Math.floor(Date.now() / 1000)

export function success<T>(data?: T): CommonResponse<T> {
  return data === undefined
    ? { code: 200, message: 'success', timestamp: now() }
    : { code: 200, message: 'success', data, timestamp: now() }
}

export function failure(code: number, message: string): CommonResponse {
  return { code, message, timestamp: now() }
}

export function jsonError(c: Context, code: number, message: string): Response {
  return c.json(failure(code, message), code as 400 | 401 | 404 | 405 | 413 | 500 | 502 | 503)
}

export class BarkError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
