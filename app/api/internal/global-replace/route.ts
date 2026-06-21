/**
 * POST /api/internal/global-replace
 * Body: { projectId, replacements: [{ from, to }] }
 * Applies exact string replacements EVERYWHERE: all draft pages, all published pages,
 * shared_nav_html, shared_footer_html, shared_css. Clears stale blocks on changed pages.
 * Use for nav/footer text or shared component CSS that appears across the whole site.
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
  const replacements = (body?.replacements as Array<{ from: string; to: string }> | undefined) ?? []
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  if (replacements.length === 0) return NextResponse.json({ error: 'no replacements' }, { status: 400 })

  const supabase = getSupabase()
  const { data, error } = await supabase.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const config = (data.site_config ?? {}) as Record<string, unknown>
  const applied: Record<string, number> = {}

  const applyToStr = (s: string): { out: string; changed: boolean } => {
    let out = s
    let changed = false
    for (const r of replacements) {
      if (!r.from) continue
      const count = out.split(r.from).length - 1
      if (count > 0) {
        out = out.split(r.from).join(r.to)
        applied[r.from] = (applied[r.from] ?? 0) + count
        changed = true
      }
    }
    return { out, changed }
  }

  const fixArr = (arr: Array<{ slug: string; html: string; blocks?: unknown }> | undefined) =>
    (arr ?? []).map(p => {
      const { out, changed } = applyToStr(p.html ?? '')
      return changed ? { ...p, html: out, blocks: undefined } : p
    })

  const fixedPages = fixArr(config.pages as Array<{ slug: string; html: string }>)
  const fixedPublished = fixArr(config.published_pages as Array<{ slug: string; html: string }>)

  const newConfig: Record<string, unknown> = { ...config, pages: fixedPages, published_pages: fixedPublished }
  for (const field of ['shared_nav_html', 'shared_footer_html', 'shared_css']) {
    if (typeof config[field] === 'string') {
      const { out, changed } = applyToStr(config[field] as string)
      if (changed) newConfig[field] = out
    }
  }

  const totalApplied = Object.values(applied).reduce((a, b) => a + b, 0)
  if (totalApplied === 0) return NextResponse.json({ message: 'Nessuna corrispondenza trovata', applied })

  const { error: saveErr } = await supabase.from('projects').update({
    site_config: newConfig,
    updated_at: new Date().toISOString(),
  }).eq('id', projectId)
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })

  return NextResponse.json({ message: 'Sostituzioni globali applicate (draft + live + shared)', applied })
}
