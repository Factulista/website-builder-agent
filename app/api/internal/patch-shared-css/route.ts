/**
 * GET  /api/internal/patch-shared-css?projectId=  — dump shared_css
 * POST /api/internal/patch-shared-css              — apply regex replacements to shared_css
 * Body: { projectId, replacements: [{from, to}] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireInternalSecret } from '../../../../lib/api-auth'
export const runtime = 'nodejs'
function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr

  const projectId = req.nextUrl.searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  const supabase = getSupabase()
  const { data, error } = await supabase.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const cfg = (data.site_config ?? {}) as Record<string, unknown>
  const css = (cfg.shared_css as string | undefined) ?? ''
  // Find btn-accent-nav rule
  const m = css.match(/\.btn-accent-nav[\s\S]*?border-radius:[^;]+;/)
  return NextResponse.json({
    length: css.length,
    btn_accent_nav_radius: m ? m[0].slice(-80) : 'not found',
    snippet: css.slice(0, 500),
  })
}

export async function POST(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr

  const body = await req.json().catch(() => null)
  const projectId = body?.projectId as string | undefined
  const replacements = (body?.replacements as Array<{ from: string; to: string }>) ?? []
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  const supabase = getSupabase()
  const { data, error } = await supabase.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const cfg = (data.site_config ?? {}) as Record<string, unknown>
  let css = (cfg.shared_css as string | undefined) ?? ''
  const applied: Record<string, number> = {}
  for (const r of replacements) {
    const count = css.split(r.from).length - 1
    if (count > 0) { css = css.split(r.from).join(r.to); applied[r.from.slice(0, 40)] = count }
  }
  if (Object.keys(applied).length === 0) return NextResponse.json({ message: 'no matches', applied })
  const { error: saveErr } = await supabase.from('projects').update({
    site_config: { ...cfg, shared_css: css },
    updated_at: new Date().toISOString(),
  }).eq('id', projectId)
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })
  return NextResponse.json({ message: 'shared_css updated', applied })
}
