export type Bindings = {
  DB: D1Database
  APNS_PRIVATE_KEY?: string
  APNS_KEY_ID?: string
  APNS_TEAM_ID?: string
  APNS_TOPIC?: string
  APNS_HOST?: string
  BASIC_AUTH_USER?: string
  BASIC_AUTH_PASSWORD?: string
  BASIC_AUTH?: string
  ALLOW_NEW_DEVICE?: string
  ALLOW_QUERY_NUMS?: string
  MAX_BATCH_PUSH_COUNT?: string
  APP_VERSION?: string
  BUILD_DATE?: string
  COMMIT_SHA?: string
  FILTERBOX_DEFAULT_CHANNEL?: string
  FILTERBOX_BARK_DEVICE_KEYS?: string
  BACKDOOR_API_KEY?: string
}

export type AppEnv = { Bindings: Bindings }

export function maxBatchCount(env: Bindings): number {
  const value = Number.parseInt(env.MAX_BATCH_PUSH_COUNT ?? '-1', 10)
  return Number.isFinite(value) ? value : -1
}

export function enabled(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return value !== 'false' && Boolean(value)
}
