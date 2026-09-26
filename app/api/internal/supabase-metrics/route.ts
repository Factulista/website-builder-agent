/**
 * GET /api/internal/supabase-metrics
 * Reads the Supabase project's Prometheus endpoint (/customer/v1/privileged/metrics,
 * basic auth with the service role key — which only lives server-side on Vercel) and
 * returns summed counters for CPU, disk I/O, network and Postgres activity, plus the
 * server's boot time. Counters are cumulative since boot: sample twice to get a
 * current rate, compare with the since-boot average to see a trend.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireInternalSecret } from '../../../../lib/api-auth'
export const runtime = 'nodejs'

const WANTED = [
  'node_boot_time_seconds', 'node_time_seconds',
  'node_cpu_seconds_total',
  'node_disk_read_bytes_total', 'node_disk_written_bytes_total',
  'node_disk_reads_completed_total', 'node_disk_writes_completed_total',
  'node_network_transmit_bytes_total', 'node_network_receive_bytes_total',
  'pg_stat_database_blks_read', 'pg_stat_database_blks_hit',
  'pg_stat_database_tup_returned', 'pg_stat_database_tup_fetched',
  'pg_stat_database_xact_commit', 'pg_stat_database_stats_reset',
  'node_memory_MemAvailable_bytes', 'node_memory_MemTotal_bytes', 'node_load1',
]

export async function GET(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const res = await fetch(`${base}/customer/v1/privileged/metrics`, {
    headers: { Authorization: 'Basic ' + Buffer.from(`service_role:${key}`).toString('base64') },
    cache: 'no-store',
  })
  if (!res.ok) return NextResponse.json({ error: `metrics HTTP ${res.status}`, body: (await res.text()).slice(0, 300) }, { status: 502 })
  const text = await res.text()
  // ?raw=prefix1,prefix2 → raw exposition lines for those metric-name prefixes (debug)
  const raw = req.nextUrl.searchParams.get('raw')
  if (raw) {
    const prefixes = raw.split(',').filter(Boolean)
    const lines = text.split('\n').filter(l => !l.startsWith('#') && prefixes.some(pr => l.startsWith(pr)))
    return NextResponse.json({ sampledAt: new Date().toISOString(), lines: lines.slice(0, 400) })
  }
  const sums: Record<string, number> = {}
  const cpuByMode: Record<string, number> = {}
  const names = new Set<string>()
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+([0-9.eE+-]+|NaN)/)
    if (!m) continue
    names.add(m[1])
    const v = Number(m[3]); if (!Number.isFinite(v)) continue
    if (m[1] === 'node_cpu_seconds_total') {
      const mode = m[2]?.match(/mode="([^"]+)"/)?.[1] ?? '?'
      cpuByMode[mode] = (cpuByMode[mode] ?? 0) + v
    }
    // Only the project database for pg_stat_database (skip template/system dbs)
    if (m[1].startsWith('pg_stat_database_') && m[2] && !/datname="postgres"/.test(m[2])) continue
    // Physical disks/interfaces only (skip loop/ram/lo)
    if (/node_disk_/.test(m[1]) && m[2] && /device="(loop|ram)/.test(m[2])) continue
    if (/node_network_/.test(m[1]) && m[2] && /device="lo"/.test(m[2])) continue
    if (WANTED.includes(m[1])) sums[m[1]] = (sums[m[1]] ?? 0) + v
  }
  return NextResponse.json({
    sampledAt: new Date().toISOString(),
    sums, cpuByMode,
    availableMetricNames: req.nextUrl.searchParams.get('names') === '1' ? [...names].sort() : undefined,
  })
}
