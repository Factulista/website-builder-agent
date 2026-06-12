/**
 * Token encryption at rest (AES-256-GCM).
 *
 * Social access/refresh tokens are encrypted before being stored in the DB and
 * decrypted only server-side at publish time. They never reach the browser.
 *
 * Requires env var SOCIAL_TOKEN_ENCRYPTION_KEY = 64 hex chars (32 bytes).
 * Generate one with:  openssl rand -hex 32
 */
import crypto from 'crypto'

const ALGO = 'aes-256-gcm'

function getKey(): Buffer {
  const hex = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error('SOCIAL_TOKEN_ENCRYPTION_KEY mancante o non valida (servono 64 hex = 32 byte). Genera con: openssl rand -hex 32')
  }
  return Buffer.from(hex, 'hex')
}

/** Encrypt a plaintext token → "iv:tag:ciphertext" (all hex). */
export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`
}

/** Decrypt "iv:tag:ciphertext" back to plaintext. */
export function decryptToken(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(':')
  if (!ivHex || !tagHex || !dataHex) throw new Error('Token cifrato malformato')
  const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8')
}
