/**
 * Cron job: marks stale 'running' agent_runs as 'abandoned'.
 * Runs every 10 minutes via Vercel Cron.
 *
 * A run is considered abandoned if:
 * - status is still 'running'
 * - created_at is older than 10 minutes
 * - This catches: browser-closed mid-run, network errors, crashes
 *
 * Schedule: already added to vercel.json — runs every 10 minutes.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Mark runs stuck in 'running' for more than 10 minutes as 'abandoned'
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('agent_runs')
    .update({
      status: 'abandoned',
      output_summary: 'Run abbandonata — connessione interrotta prima del completamento',
      completed_at: new Date().toISOString(),
    })
    .eq('status', 'running')
    .lt('created_at', cutoff)
    .select('id, agent_type, created_at')

  if (error) {
    console.error('[cleanup-runs] error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const count = data?.length ?? 0
  if (count > 0) {
    console.log(`[cleanup-runs] marked ${count} runs as abandoned:`, data?.map(r => `${r.agent_type}@${r.created_at}`))
  }

  return NextResponse.json({
    cleaned: count,
    cutoff,
    timestamp: new Date().toISOString(),
  })
}
