export type PushMessage = {
  id?: string
  deviceKey: string
  deviceToken: string
  title: string
  subtitle: string
  body: string
  sound: string
  ext: Record<string, unknown>
}

export type ApnsPayload = Record<string, unknown> & {
  aps: Record<string, unknown>
}

export type ApnsResponse = {
  status: number
  reason?: string
  apnsId?: string
}
