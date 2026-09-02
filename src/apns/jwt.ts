type CachedToken = { cacheKey: string; token: string; createdAt: number }

let cached: CachedToken | undefined

export async function createApnsToken(privateKeyPem: string, keyId: string, teamId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const cacheKey = `${keyId}:${teamId}:${privateKeyPem.slice(-40)}`
  if (cached?.cacheKey === cacheKey && now - cached.createdAt < 50 * 60) return cached.token

  const header = base64UrlJson({ alg: 'ES256', kid: keyId })
  const claims = base64UrlJson({ iss: teamId, iat: now })
  const input = `${header}.${claims}`
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKeyPem),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(input),
  )
  const token = `${input}.${base64Url(new Uint8Array(signature))}`
  cached = { cacheKey, token, createdAt: now }
  return token
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const normalized = pem.replaceAll('\\n', '\n')
  const encoded = normalized
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

function base64UrlJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)))
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}
