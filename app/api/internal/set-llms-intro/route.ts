/**
 * POST /api/internal/set-llms-intro
 * Sets site_config.llmsIntroduction — the fact-rich intro block served at the
 * top of /llms.txt and /llms-full.txt (GEO: citable facts for AI assistants).
 * Body: { projectId, llmsIntroduction }  — pass "" to remove.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { patchSiteConfig } from '../../../../lib/site-config-patch'
import { requireInternalSecret } from '../../../../lib/api-auth'
export const runtime = 'nodejs'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function POST(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr

  const body = await req.json().catch(() => null)
  const projectId = body?.projectId as string | undefined
  const llmsIntroduction = body?.llmsIntroduction as string | undefined
  if (!projectId || llmsIntroduction === undefined) {
    return NextResponse.json({ error: 'projectId and llmsIntroduction required' }, { status: 400 })
  }
  const supabase = getSupabase()
  const { error: upErr } = await patchSiteConfig(supabase, projectId, [
    llmsIntroduction === '' ? { path: ['llmsIntroduction'], delete: true } : { path: ['llmsIntroduction'], value: llmsIntroduction },
  ])
  if (upErr) return NextResponse.json({ error: upErr }, { status: 500 })

  return NextResponse.json({
    message: llmsIntroduction === '' ? 'llmsIntroduction removed' : `llmsIntroduction set (${llmsIntroduction.length} chars)`,
  })
}
