/**
 * POST /api/internal/fix-footer-hover?projectId=xxx&color=%23fbbf24
 * Aligns the footer link hover color across all pages (the shared footer should
 * look identical everywhere). Replaces `.footer-links a:hover` / `.footer-bottom
 * a:hover { color: #000 }` with the given accent color.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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
  const projectId = req.nextUrl.searchParams.get('projectId')
  const color = req.nextUrl.searchParams.get('color') || '#fbbf24'
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const supabase = getSupabase()
  const { data, error } = await supabase.from('projects').select('id, site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const config = (data.site_config ?? {}) as Record<string, unknown>
  const pages = (config.pages as Array<{ slug: string; html: string }>) ?? []

  let changed = 0
  const fixed = pages.map(p => {
    const r = fixHover(p.html ?? '', color)
    if (r.changed) changed++
    return { ...p, html: r.html }
  })

  if (changed === 0) return NextResponse.json({ message: 'Nothing to change', changed: 0 })

  const { error: saveErr } = await supabase.rpc('save_inline_pages', { p_id: projectId, p_pages: fixed })
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })
  return NextResponse.json({ message: `Footer hover aligned to ${color} on ${changed} page(s)`, changed })
}
