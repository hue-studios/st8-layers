// Web Push message encryption (RFC 8291, `aes128gcm` from RFC 8188) and VAPID (RFC 8292), with Web Crypto only: no
// dependency, nothing CommonJS. One record per message: the payload, the 0x02 delimiter, no padding.

const subtle = globalThis.crypto.subtle
const enc = new TextEncoder()

/** Bytes on a plain ArrayBuffer (what Web Crypto takes). */
type Bytes = Uint8Array<ArrayBuffer>

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url')
export const fromB64url = (text: string): Bytes => new Uint8Array(Buffer.from(text, 'base64url'))

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

async function hmac(key: Bytes, data: Bytes) {
  const k = await subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await subtle.sign('HMAC', k, data))
}

/** HKDF (RFC 5869) for outputs of at most 32 bytes: one HMAC block. */
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number) {
  const prk = await hmac(salt, ikm)
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length)
}

/** The largest payload one 4096-byte record holds: rs - 16 (tag) - 1 (delimiter). */
export const MAX_PAYLOAD = 4096 - 16 - 1
const RECORD_SIZE = 4096

/** True when `p256dh` is an uncompressed P-256 point on the curve and `auth` is 16 bytes. */
export async function validSubscriptionKeys(p256dh: string, auth: string) {
  try {
    const point = fromB64url(p256dh)
    if (point.length !== 65 || point[0] !== 4 || fromB64url(auth).length !== 16) return false
    await subtle.importKey('raw', point, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    return true
  } catch {
    return false
  }
}

/** Encrypt `payload` for one subscription (RFC 8291 §3.4): the request body, Content-Encoding aes128gcm. */
export async function encryptPayload(payload: Bytes, keys: { p256dh: string, auth: string }) {
  if (payload.length > MAX_PAYLOAD) throw new Error(`push payload too large (${payload.length} bytes)`)
  const uaPublic = fromB64url(keys.p256dh)
  const authSecret = fromB64url(keys.auth)
  const ua = await subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const as = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
  const asPublic = new Uint8Array(await subtle.exportKey('raw', as.publicKey))
  const ecdhSecret = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: ua }, as.privateKey, 256))

  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)

  const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const cipher = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))))

  const header = new Uint8Array(16 + 4 + 1)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, RECORD_SIZE)
  header[20] = asPublic.length
  return concat(header, asPublic, cipher)
}

export interface VapidKeys {
  /** The uncompressed public point, base64url (65 bytes). */
  publicKey: string
  /** The private scalar d, base64url (32 bytes). */
  privateKey: string
  /** mailto: (or https:) contact for the push services. */
  subject: string
}

let signingKey: { privateKey: string, key: Promise<CryptoKey> } | null = null
const tokens = new Map<string, { value: string, until: number }>()

function importSigningKey(keys: VapidKeys) {
  if (signingKey?.privateKey !== keys.privateKey) {
    const point = fromB64url(keys.publicKey)
    if (point.length !== 65 || point[0] !== 4) throw new Error('VAPID public key is not an uncompressed P-256 point')
    const jwk = { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64url(point.slice(1, 33)), y: b64url(point.slice(33)), ext: false }
    signingKey = { privateKey: keys.privateKey, key: Promise.resolve(subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])) }
    tokens.clear()
  }
  return signingKey.key
}

/** The VAPID Authorization header for a push service origin (RFC 8292 §2), a 12 h JWT reused for 11 h. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys) {
  const aud = new URL(endpoint).origin
  const now = Math.floor(Date.now() / 1000)
  let token = tokens.get(aud)
  if (!token || token.until <= now) {
    const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
    const claims = b64url(enc.encode(JSON.stringify({ aud, exp: now + 12 * 3600, sub: keys.subject })))
    const signature = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await importSigningKey(keys), enc.encode(`${header}.${claims}`)))
    token = { value: `${header}.${claims}.${b64url(signature)}`, until: now + 11 * 3600 }
    tokens.set(aud, token)
  }
  return `vapid t=${token.value}, k=${keys.publicKey}`
}

/** A Topic header value (≤ 32 base64url characters): a newer undelivered push with the same topic replaces the older. */
export async function topicOf(tag: string) {
  return b64url(new Uint8Array(await subtle.digest('SHA-256', enc.encode(tag)))).slice(0, 32)
}
