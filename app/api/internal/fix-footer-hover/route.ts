/**
 * POST /api/internal/fix-footer-hover?projectId=xxx&color=%23fbbf24
 * Aligns the footer link hover color across all pages (the shared footer should
 * look identical everywhere). Replaces `.footer-links a:hover` / `.footer-bottom
 * a:hover { color: #000 }` with the given accent color.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireInternalSecret } from '../../../../lib/api-auth'

export const runtime = 'nodejs'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

function fixHover(html: string, color: string): { html: string; changed: boolean } {
  // Match .footer-links a:hover and .footer-bottom a:hover rules with any color,
  // normalize the color to the accent. Keeps optional !important.
  const re = /(\.footer-(?:links|bottom) a:hover\s*\{\s*color:\s*)(#[0-9a-fA-F]{3,6})(\s*(?:!important)?\s*;?\s*\})/gi
  const out = html.replace(re, (_m, pre, _col, post) => `${pre}${color}${post}`)
  return { html: out, changed: out !== html }
}

export async function POST(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr

  const projectId = req.nextUrl.searchParams.get('projectId')
  const color = req.nextUrl.searchParams.get('color') || '#fbbf24'
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const supabase = getSupabase()
  const { data, error } = await supabase.from('projects').select('id, site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const config = (data.site_config ?? {}) as Record<string, unknown>
  let changed = 0
  const fixArr = (arr: Array<{ slug: string; html: string }> | undefined) =>
    (arr ?? []).map(p => {
      const r = fixHover(p.html ?? '', color)
      if (r.changed) changed++
      return { ...p, html: r.html }
    })

  // Fix draft (pages), live (published_pages), AND shared_css — the frame CSS is
  // extracted from shared_css and injected on every page, so the black rule there
  // overrides the per-page one. Must fix all three.
  const fixedPages = fixArr(config.pages as Array<{ slug: string; html: string }>)
  const fixedPublished = fixArr(config.published_pages as Array<{ slug: string; html: string }>)
  let fixedSharedCss = config.shared_css as string | undefined
  if (typeof fixedSharedCss === 'string') {
    const r = fixHover(fixedSharedCss, color)
    if (r.changed) { fixedSharedCss = r.html; changed++ }
  }

  if (changed === 0) return NextResponse.json({ message: 'Nothing to change', changed: 0 })

  const { error: saveErr } = await supabase.from('projects').update({
    site_config: { ...config, pages: fixedPages, published_pages: fixedPublished, shared_css: fixedSharedCss },
    updated_at: new Date().toISOString(),
  }).eq('id', projectId)
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })
  return NextResponse.json({ message: `Footer hover aligned to ${color} (draft + live), ${changed} page(s)`, changed })
}
