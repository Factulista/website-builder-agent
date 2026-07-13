/**
 * POST /api/internal/strip-mobile-menu
 * Body: { projectId }
 * Removes <div id="mobileMenu"...>...</div> from ALL draft + published page HTMLs.
 * After this, the mobile-menu lives only in shared_nav_html (added separately via
 * patch-shared-nav) and is rebuilt at serve time by rebuildMobileMenu.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
export const runtime = 'nodejs'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

function stripMobileMenu(html: string): { out: string; stripped: boolean } {
  const re = /<div[^>]*id="mobileMenu"[^>]*>[\s\S]*?<\/div>/
  const match = re.exec(html)
  if (!match) return { out: html, stripped: false }
  return { out: html.slice(0, match.index) + html.slice(match.index + match[0].length), stripped: true }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const projectId = body?.projectId as string | undefined
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const supabase = getSupabase()
  const { data, error } = await supabase.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const config = (data.site_config ?? {}) as Record<string, unknown>
  const pages = (config.pages as Array<{ slug: string; html: string }>) ?? []
  const published = (config.published_pages as Array<{ slug: string; html: string }>) ?? []

  let draftStripped = 0
  let publishedStripped = 0

  const newPages = pages.map(p => {
    const { out, stripped } = stripMobileMenu(p.html ?? '')
    if (stripped) draftStripped++
    return stripped ? { ...p, html: out, blocks: undefined } : p
  })

  const newPublished = published.map(p => {
    const { out, stripped } = stripMobileMenu(p.html ?? '')
    if (stripped) publishedStripped++
    return stripped ? { ...p, html: out, blocks: undefined } : p
  })

  const { error: saveErr } = await supabase.from('projects').update({
    site_config: { ...config, pages: newPages, published_pages: newPublished },
    updated_at: new Date().toISOString(),
  }).eq('id', projectId)
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })

  return NextResponse.json({ message: 'mobile-menu stripped from pages', draftStripped, publishedStripped })
}
