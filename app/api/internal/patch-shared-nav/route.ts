/**
 * POST /api/internal/patch-shared-nav
 * Body: { projectId, replacements: [{ from, to }] }
 * Applies exact string replacements to site_config.shared_nav_html — the actual
 * source of truth for the served <nav> (injectSharedComponents in lib/preview.ts
 * replaces every page's own <nav> with this at serve time). replace-in-page only
 * touches per-page html, which is why it can't fix nav bugs.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
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
  const replacements = (body?.replacements as Array<{ from: string; to: string }> | undefined) ?? []
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  if (replacements.length === 0) return NextResponse.json({ error: 'no replacements' }, { status: 400 })

  const supabase = getSupabase()
  const { data, error } = await supabase.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const config = (data.site_config ?? {}) as Record<string, unknown>
  let nav = (config.shared_nav_html as string | undefined) ?? ''
  const applied: Record<string, number> = {}

  for (const r of replacements) {
    if (!r.from || !r.to) continue
    const count = nav.split(r.from).length - 1
    if (count > 0) {
      nav = nav.split(r.from).join(r.to)
      applied[r.from] = (applied[r.from] ?? 0) + count
    }
  }

  const totalApplied = Object.values(applied).reduce((a, b) => a + b, 0)
  if (totalApplied === 0) return NextResponse.json({ message: 'Nessuna corrispondenza trovata', applied })

  const { error: saveErr } = await supabase.from('projects').update({
    site_config: { ...config, shared_nav_html: nav },
    updated_at: new Date().toISOString(),
  }).eq('id', projectId)
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })

  return NextResponse.json({ message: 'shared_nav_html aggiornato', applied })
}
