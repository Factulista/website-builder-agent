/**
 * POST /api/internal/unpublish-pages
 * Body: { projectId, slugs: string[] }
 * Removes the given slugs from published_pages ONLY — draft `pages` is left untouched,
 * so the pages keep working in preview but disappear from the live/published site.
 * The mirror of publish-page (which adds one slug); this removes many at once.
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
  const slugs = (body?.slugs as string[] | undefined) ?? []
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  if (slugs.length === 0) return NextResponse.json({ error: 'slugs required' }, { status: 400 })

  const supabase = getSupabase()
  const { data, error } = await supabase.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const config = (data.site_config ?? {}) as Record<string, unknown>
  const published = (config.published_pages as Array<{ slug: string }> | undefined) ?? []
  const slugSet = new Set(slugs)
  const before = published.length
  const remaining = published.filter(p => !slugSet.has(p.slug))
  const removed = published.filter(p => slugSet.has(p.slug)).map(p => p.slug)

  if (removed.length === 0) {
    return NextResponse.json({ message: 'Nessuna delle slug indicate era pubblicata', removed: [] })
  }

  const { error: saveErr } = await supabase.from('projects').update({
    site_config: { ...config, published_pages: remaining },
    updated_at: new Date().toISOString(),
  }).eq('id', projectId)
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })

  return NextResponse.json({ message: `Rimosse ${removed.length} pagine da published_pages (${before} → ${remaining.length})`, removed })
}
