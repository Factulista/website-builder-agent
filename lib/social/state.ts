/**
 * Signed OAuth state. The connect route (authenticated) embeds the user id in a
 * signed token; the callback (an unauthenticated browser redirect from the
 * provider) verifies the signature to recover the user id. Prevents CSRF /
 * tampering. Signed with SOCIAL_TOKEN_ENCRYPTION_KEY.
 */
import crypto from 'crypto'

type StatePayload = { userId: string; provider: string; ts: number }

function secret(): string {
  const k = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY
  if (!k) throw new Error('SOCIAL_TOKEN_ENCRYPTION_KEY mancante')
  return k
}

export function signState(payload: Omit<StatePayload, 'ts'>): string {
  const full: StatePayload = { ...payload, ts: Date.now() }
  const data = Buffer.from(JSON.stringify(full)).toString('base64url')
  const sig = crypto.createHmac('sha256', secret()).update(data).digest('base64url')
  return `${data}.${sig}`
}

export function verifyState(state: string): StatePayload {
  const [data, sig] = state.split('.')
  if (!data || !sig) throw new Error('State malformato')
  const expected = crypto.createHmac('sha256', secret()).update(data).digest('base64url')
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error('State non valido (firma)')
  }
  const payload = JSON.parse(Buffer.from(data, 'base64url').toString()) as StatePayload
  // Expire after 10 minutes
  if (Date.now() - payload.ts > 10 * 60 * 1000) throw new Error('State scaduto')
  return payload
}
