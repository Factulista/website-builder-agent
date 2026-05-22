// In-memory cache for /api/admin/runs/stats (30s TTL).
// getRunStats() scans the full agent_runs table, so it's the most expensive
// call in the back-office. Cache prevents repeated scans on every page load.

import type { getRunStats } from './run-logger'

type StatsShape = Awaited<ReturnType<typeof getRunStats>>

let cache: { data: StatsShape; expires: number } | null = null
const STATS_TTL_MS = 30_000

export function getStatsCache(): StatsShape | null {
  if (cache && cache.expires > Date.now()) return cache.data
  return null
}

export function setStatsCache(data: StatsShape): void {
  cache = { data, expires: Date.now() + STATS_TTL_MS }
}

export function invalidateStatsCache(): void {
  cache = null
}
