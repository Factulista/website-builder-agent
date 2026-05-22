import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isAdmin } from '../../../../../lib/admin'
import { getRunStats } from '../../../../../lib/agents/run-logger'
import { getStatsCache, setStatsCache } from '../../../../../lib/agents/runs-cache'

async function verifyAdmin(req: NextRequest): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return { ok: false, error: 'No token' }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return { ok: false, error: 'Invalid token' }
  if (!isAdmin(user.email)) return { ok: false, error: 'Not admin' }
  return { ok: true }
}

export async function GET(req: NextRequest) {
  const auth = await verifyAdmin(req)
  if (!auth.ok) return Response.json({ error: auth.error }, { status: 401 })

  // Cache hit: skip Supabase entirely (30s TTL)
  const cached = getStatsCache()
  if (cached) return Response.json(cached)

  try {
    const stats = await getRunStats()
    setStatsCache(stats)
    return Response.json(stats)
  } catch (err) {
    const msg = String(err)
    if (msg.includes('TABLE_MISSING')) {
      // Table not yet created — return empty stats instead of 500
      return Response.json({
        byDay: [],
        totals: { success: 0, error: 0, running: 0, total: 0 },
        tokens: { input: 0, output: 0, cache_read: 0 },
        avgDuration: null,
        totalCost: 0,
        _warning: 'agent_runs table missing — run SQL migration',
      })
    }
    console.error('[admin/runs/stats] getRunStats error:', err)
    return Response.json({ error: msg }, { status: 500 })
  }
}
