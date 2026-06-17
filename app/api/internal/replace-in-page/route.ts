/**
 * POST /api/internal/replace-in-page
 * Body: { projectId, slug, replacements: [{ from, to }] }
 * Applies exact string replacements (e.g. swap placeholder image URLs for real ones)
 * in a page's HTML — both draft (pages) and live (published_pages). Clears stale blocks.
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
  const slug = (body?.slug as string | undefined) ?? 'home'
  const replacements = (body?.replacements as Array<{ from: string; to: string }> | undefined) ?? []
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  if (replacements.length === 0) return NextResponse.json({ error: 'no replacements' }, { status: 400 })

  const supabase = getSupabase()
  const { data, error } = await supabase.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const config = (data.site_config ?? {}) as Record<string, unknown>
  const applied: Record<string, number> = {}

  const fixArr = (arr: Array<{ slug: string; html: string; blocks?: unknown }> | undefined) =>
    (arr ?? []).map(p => {
      if (p.slug !== slug) return p
      let html = p.html ?? ''
      let pageChanged = false
      for (const r of replacements) {
        if (!r.from || !r.to) continue
        const count = html.split(r.from).length - 1
        if (count > 0) {
          html = html.split(r.from).join(r.to)
          applied[r.from] = (applied[r.from] ?? 0) + count
          pageChanged = true
        }
      }
      return pageChanged ? { ...p, html, blocks: undefined } : p
    })

  const fixedPages = fixArr(config.pages as Array<{ slug: string; html: string }>)
  const fixedPublished = fixArr(config.published_pages as Array<{ slug: string; html: string }>)

  const totalApplied = Object.values(applied).reduce((a, b) => a + b, 0)
  if (totalApplied === 0) return NextResponse.json({ message: 'Nessuna corrispondenza trovata', applied })

  const { error: saveErr } = await supabase.from('projects').update({
    site_config: { ...config, pages: fixedPages, published_pages: fixedPublished },
    updated_at: new Date().toISOString(),
  }).eq('id', projectId)
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })

  return NextResponse.json({ message: `Sostituzioni applicate su "${slug}" (draft + live)`, applied })
}
