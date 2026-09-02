import type { Bindings } from '../env'
import { ApnsClient } from '../apns/client'
import { messageFromParams } from '../apns/payload'
import type { PushMessage } from '../apns/types'
import { DeviceRepository } from '../repositories/device-repository'
import { BarkError } from './response'

export type BatchResult = { code: number; device_key: string; message?: string }

export class PushService {
  private readonly repository: DeviceRepository
  private readonly apns: ApnsClient

  constructor(private readonly env: Bindings) {
    this.repository = new DeviceRepository(env.DB)
    this.apns = new ApnsClient(env)
  }

  async push(params: Record<string, unknown>): Promise<void> {
    const base = messageFromParams(params)
    let deviceToken: string
    try {
      deviceToken = await this.repository.findToken(base.deviceKey)
    } catch (error) {
      if (error instanceof BarkError && error.message.startsWith('failed to get [')) {
        throw new BarkError(400, `failed to get device token: ${error.message}`)
      }
      throw error
    }
    await this.send({ ...base, deviceToken })
  }

  async pushBatch(deviceKeys: string[], params: Record<string, unknown>): Promise<BatchResult[]> {
    const tokenMap = await this.repository.findTokens(deviceKeys)
    const results: BatchResult[] = new Array(deviceKeys.length)
    let cursor = 0
    const worker = async () => {
      while (true) {
        const index = cursor++
        if (index >= deviceKeys.length) return
        const deviceKey = deviceKeys[index]!
        if (!deviceKey) {
          results[index] = { code: 400, device_key: deviceKey, message: 'device key is empty' }
          continue
        }
        const token = tokenMap.get(deviceKey)
        if (!token) {
          results[index] = {
            code: 400,
            device_key: deviceKey,
            message: `failed to get device token: failed to get [${deviceKey}] device token from database`,
          }
          continue
        }
        try {
          const base = messageFromParams({ ...params, device_key: deviceKey })
          await this.send({ ...base, deviceToken: token })
          results[index] = { code: 200, device_key: deviceKey }
        } catch (error) {
          results[index] = {
            code: error instanceof BarkError ? error.status : 500,
            device_key: deviceKey,
            message: error instanceof Error ? error.message : String(error),
          }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(10, deviceKeys.length) }, worker))
    return results
  }

  private async send(message: PushMessage): Promise<void> {
    const response = await this.apns.push(message)
    if (response.status === 410 || response.status === 400 && response.reason === 'BadDeviceToken') {
      await this.repository.invalidate(message.deviceKey)
    }
    if (response.status !== 200) throw new BarkError(500, `push failed: ${response.reason ?? response.status}`)
  }
}
