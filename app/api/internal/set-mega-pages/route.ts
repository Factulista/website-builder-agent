/**
 * POST /api/internal/set-mega-pages
 * Assigns megaMenu field to pages (both draft + published) in bulk.
 * Body: { projectId, assignments: [{ slug, megaMenu }] }
 * Pass megaMenu: "" to remove a page from all mega menus.
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
  const assignments = (body?.assignments as Array<{ slug: string; megaMenu: string }>) ?? []
  if (!projectId || !assignments.length) {
    return NextResponse.json({ error: 'projectId and assignments required' }, { status: 400 })
  }
  const supabase = getSupabase()
  const { data, error } = await supabase.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const cfg = (data.site_config ?? {}) as Record<string, unknown>
  const assignMap = new Map(assignments.map(a => [a.slug, a.megaMenu]))

  const applyToList = (list: Array<Record<string, unknown>>) =>
    list.map(p => {
      const slug = p.slug as string
      if (!assignMap.has(slug)) return p
      const mm = assignMap.get(slug)
      return mm ? { ...p, megaMenu: mm } : { ...p, megaMenu: undefined }
    })

  const pages = applyToList((cfg.pages as Array<Record<string, unknown>>) ?? [])
  const published = applyToList((cfg.published_pages as Array<Record<string, unknown>>) ?? [])

  const applied = assignments.filter(a => [...pages, ...published].some(p => p.slug === a.slug)).map(a => a.slug)

  const { error: saveErr } = await supabase.from('projects').update({
    site_config: { ...cfg, pages, published_pages: published },
    updated_at: new Date().toISOString(),
  }).eq('id', projectId)

  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })
  return NextResponse.json({ message: 'mega menu assignments updated', applied })
}
