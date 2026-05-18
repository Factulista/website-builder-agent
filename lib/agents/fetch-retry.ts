/**
 * fetchWithRetry — wrapper around fetch that retries on Anthropic overload errors.
 *
 * Retries on:
 *  - HTTP 529 (overloaded)
 *  - HTTP 500/503 with "overloaded" in body
 *
 * Uses exponential backoff: 5s → 10s → 20s → 40s (max 4 attempts total).
 */

const MAX_RETRIES = 4
const BASE_DELAY_MS = 5000

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  agentName = 'agent'
): Promise<Response> {
  let lastErr: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, options)

    if (res.ok) return res

    // Clone to read body without consuming
    const body = await res.clone().text().catch(() => '')
    const isOverloaded =
      res.status === 529 ||
      body.includes('overloaded') ||
      (res.status === 500 && body.includes('overloaded'))

    if (!isOverloaded || attempt >= MAX_RETRIES) {
      // Non-retryable error or exhausted retries — return the failed response
      // so callers can read the body
      return res
    }

    const delayMs = BASE_DELAY_MS * Math.pow(2, attempt) // 5s, 10s, 20s, 40s
    console.warn(
      `[${agentName}] overloaded (attempt ${attempt + 1}/${MAX_RETRIES}) — retrying in ${delayMs / 1000}s`
    )
    await sleep(delayMs)
  }

  // Should not reach here, but TypeScript needs it
  throw lastErr ?? new Error(`${agentName}: exhausted retries`)
}
