// In-memory cache for /api/admin/agents list response.
// Avoids hitting Supabase on every page load (60s TTL).
// Invalidated explicitly when an agent is updated.

import type { DbAgentConfig } from './db-config'

let cache: { data: DbAgentConfig[]; expires: number } | null = null
const CACHE_TTL_MS = 60_000

export function getAgentsCache(): DbAgentConfig[] | null {
  if (cache && cache.expires > Date.now()) return cache.data
  return null
}

export function setAgentsCache(data: DbAgentConfig[]): void {
  cache = { data, expires: Date.now() + CACHE_TTL_MS }
}

export function invalidateAgentsCache(): void {
  cache = null
}

// syncAgentMetadata should run only ONCE per server lifetime, not per request
let syncedOnce = false

export function shouldRunSync(): boolean {
  if (syncedOnce) return false
  syncedOnce = true
  return true
}

export function resetSyncFlag(): void {
  syncedOnce = false
}
