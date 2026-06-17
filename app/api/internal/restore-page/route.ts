/**
 * POST /api/internal/restore-page?projectId=xxx&slug=home
 * Restores a DRAFT page (site_config.pages) from its last PUBLISHED version
 * (site_config.published_pages). Use to recover content accidentally lost in the
 * draft while the live site still has it (publish was blocked, so live is intact).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function POST(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId')
  const slug = req.nextUrl.searchParams.get('slug') || 'home'
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const supabase = getSupabase()
  const { data, error } = await supabase.from('projects').select('id, site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const config = (data.site_config ?? {}) as Record<string, unknown>
  const pages = (config.pages as Array<{ slug: string; html: string }>) ?? []
  const published = (config.published_pages as Array<{ slug: string; html: string }>) ?? []

  const pub = published.find(p => p.slug === slug)
  if (!pub) return NextResponse.json({ error: `Nessuna versione pubblicata per "${slug}"` }, { status: 404 })

  const draftIdx = pages.findIndex(p => p.slug === slug)
  const draftLen = draftIdx >= 0 ? (pages[draftIdx].html ?? '').length : 0
  const newPages = draftIdx >= 0
    ? pages.map(p => p.slug === slug ? { ...p, html: pub.html } : p)
    : [...pages, { slug, name: slug, html: pub.html }]

  const { error: saveErr } = await supabase.rpc('save_inline_pages', { p_id: projectId, p_pages: newPages })
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })

  return NextResponse.json({
    message: `Pagina "${slug}" ripristinata dalla versione pubblicata`,
    draftBefore: draftLen,
    restoredTo: pub.html.length,
  })
}
