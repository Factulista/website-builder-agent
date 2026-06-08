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

const MAX_RETRIES = 4
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

    // For 429: respect Retry-After header (in seconds)
    let delayMs: number
    if (isRateLimit) {
      const retryAfter = res.headers.get('retry-after')
      const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : null
      // Add jitter: ±20% of delay to avoid thundering herd
      const jitter = 1 + (Math.random() * 0.4 - 0.2)
      delayMs = retryAfterMs
        ? Math.min(retryAfterMs * jitter, 60_000)
        : BASE_DELAY_MS * Math.pow(2, attempt) * jitter
    } else {
      // Overload: standard exponential backoff + jitter
      const jitter = 1 + (Math.random() * 0.3 - 0.15)
      delayMs = BASE_DELAY_MS * Math.pow(2, attempt) * jitter
    }

    const reason = isRateLimit ? 'rate limit (429)' : 'server overload (529)'
    console.warn(`[${agentName}] ${reason} — attempt ${attempt + 1}/${MAX_RETRIES}, retrying in ${Math.round(delayMs / 1000)}s`)

    onRetry?.(attempt + 1, delayMs, reason)
    await sleep(delayMs)
  }

  throw new Error(`${agentName}: exhausted retries`)
}
