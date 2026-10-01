/**
 * Per-instance request coalescing + short TTL cache for public-serving DB reads.
 *
 * Vercel Fluid compute runs many concurrent requests in the same instance, so when a
 * burst of cache misses hits the same page (crawler, viral link, the CDN purge after
 * every deploy) each request used to fire its own Supabase RPC — and each RPC makes
 * Postgres decompress the whole site_config row (~7MB) in memory. Here concurrent
 * callers with the same key share ONE in-flight promise, and the result is reused for
 * `ttlMs` (on top of the CDN cache, which already allows minutes of staleness).
 *
 * Failed or empty results are never cached, so errors/404s are retried immediately.
 * Cached values are SHARED between requests: callers must treat them as read-only.
 */
type Entry = { promise: Promise<unknown>; expires: number }

const store = new Map<string, Entry>()
const MAX_ENTRIES = 300

export function coalesce<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  isCacheable: (value: T) => boolean = v => v != null,
): Promise<T> {
  const now = Date.now()
  const hit = store.get(key)
  if (hit && hit.expires > now) return hit.promise as Promise<T>

  const promise = fn()
  store.set(key, { promise, expires: now + ttlMs })
  promise.then(
    v => { if (!isCacheable(v)) dropIfSame(key, promise) },
    () => dropIfSame(key, promise),
  )
  if (store.size > MAX_ENTRIES) {
    for (const [k, e] of store) if (e.expires <= now) store.delete(k)
    // Still too big (all fresh): drop oldest insertions first (Map keeps insertion order).
    while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value as string)
  }
  return promise
}

function dropIfSame(key: string, promise: Promise<unknown>) {
  if (store.get(key)?.promise === promise) store.delete(key)
}
