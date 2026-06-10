/**
 * POST /api/internal/cleanup-fonts?projectId=xxx
 * Removes duplicate Google Fonts <link> and @import declarations from all
 * pages HTML stored in site_config. The Design System already provides the
 * authoritative async font link — the baked-in ones are redundant bloat.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

function stripFonts(html: string): { html: string; changed: boolean } {
  const cleaned = html
    .replace(/<link[^>]+href=["'][^"']*fonts\.googleapis\.com[^"']*["'][^>]*\/?>\s*/gi, '')
    .replace(/<link[^>]+href=["'][^"']*fonts\.gstatic\.com[^"']*["'][^>]*\/?>\s*/gi, '')
    .replace(/@import\s+url\(['"]?https:\/\/fonts\.googleapis\.com[^)'"]*['"]?\)[^;]*;\s*/gi, '')
  return { html: cleaned, changed: cleaned !== html }
}

export async function POST(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('projects')
    .select('id, site_config')
    .eq('id', projectId)
    .single()

  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const config = (data.site_config ?? {}) as Record<string, unknown>
  const pages = (config.pages as Array<{ slug: string; html: string }>) ?? []

  let pagesChanged = 0
  const cleanedPages = pages.map(p => {
    const { html, changed } = stripFonts(p.html ?? '')
    if (changed) pagesChanged++
    return { ...p, html }
  })

  if (pagesChanged === 0) {
    return NextResponse.json({ message: 'Nothing to clean — no duplicate fonts found', pagesChanged: 0 })
  }

  const { error: saveErr } = await supabase.rpc('save_inline_pages', {
    p_id: projectId,
    p_pages: cleanedPages,
  })

  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })

  return NextResponse.json({ message: `Cleaned ${pagesChanged} page(s)`, pagesChanged })
}
