/**
 * fetchWithRetry — wrapper around fetch with smart retry for Anthropic API errors.
 *
 * Retries on:
 *  - HTTP 529 (overloaded)
 *  - HTTP 500/503 with "overloaded" in body
 *  - HTTP 429 (rate limit) — with Retry-After header support
 *
 * Uses exponential backoff with jitter.
 * Calls optional onRetry callback so callers can show progress to the user.
 */

const MAX_RETRIES = 2  // reduced from 4: 2×20s=40s max wait vs previous 4×60s=240s
const BASE_DELAY_MS = 5000

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export type RetryCallback = (attempt: number, delayMs: number, reason: string) => void

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  agentName = 'agent',
  onRetry?: RetryCallback
): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, options)

    if (res.ok) return res

    const body = await res.clone().text().catch(() => '')

    // Determine if retryable
    const isOverloaded =
      res.status === 529 ||
      (res.status === 503 && body.includes('overloaded')) ||
      (res.status === 500 && body.includes('overloaded'))

    const isRateLimit = res.status === 429

    if ((!isOverloaded && !isRateLimit) || attempt >= MAX_RETRIES) {
      return res  // non-retryable or exhausted — let caller handle
    }

    // For 429: cap retry delay to avoid Vercel 300s timeout.
    // Vercel Pro timeout = 300s. With 3 inspection steps each hitting 429,
    // 3 × 60s = 180s already, leaving only 120s for actual work.
    // Cap at 20s max — if Anthropic says "wait 60s", we still cap at 20s.
    // Better to fail fast than timeout the whole request.
    const MAX_DELAY_MS = 20_000
    let delayMs: number
    if (isRateLimit) {
      const retryAfter = res.headers.get('retry-after')
      const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : null
      const jitter = 1 + (Math.random() * 0.4 - 0.2)
      delayMs = retryAfterMs
        ? Math.min(retryAfterMs * jitter, MAX_DELAY_MS)
        : Math.min(BASE_DELAY_MS * Math.pow(2, attempt) * jitter, MAX_DELAY_MS)
    } else {
      const jitter = 1 + (Math.random() * 0.3 - 0.15)
      delayMs = Math.min(BASE_DELAY_MS * Math.pow(2, attempt) * jitter, MAX_DELAY_MS)
    }

    const reason = isRateLimit ? 'rate limit (429)' : 'server overload (529)'
    console.warn(`[${agentName}] ${reason} — attempt ${attempt + 1}/${MAX_RETRIES}, retrying in ${Math.round(delayMs / 1000)}s`)

    onRetry?.(attempt + 1, delayMs, reason)
    await sleep(delayMs)
  }

  throw new Error(`${agentName}: exhausted retries`)
}
