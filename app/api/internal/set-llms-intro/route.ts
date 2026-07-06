/**
 * POST /api/internal/set-llms-intro
 * Sets site_config.llmsIntroduction — the fact-rich intro block served at the
 * top of /llms.txt and /llms-full.txt (GEO: citable facts for AI assistants).
 * Body: { projectId, llmsIntroduction }  — pass "" to remove.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
export const runtime = 'nodejs'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const projectId = body?.projectId as string | undefined
  const llmsIntroduction = body?.llmsIntroduction as string | undefined
  if (!projectId || llmsIntroduction === undefined) {
    return NextResponse.json({ error: 'projectId and llmsIntroduction required' }, { status: 400 })
  }
  const supabase = getSupabase()
  const { data, error } = await supabase.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const cfg = (data.site_config ?? {}) as Record<string, unknown>
  if (llmsIntroduction === '') {
    delete cfg.llmsIntroduction
  } else {
    cfg.llmsIntroduction = llmsIntroduction
  }

  const { error: upErr } = await supabase.from('projects').update({ site_config: cfg }).eq('id', projectId)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  return NextResponse.json({
    message: llmsIntroduction === '' ? 'llmsIntroduction removed' : `llmsIntroduction set (${llmsIntroduction.length} chars)`,
  })
}
