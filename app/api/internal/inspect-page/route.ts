/**
 * GET /api/internal/inspect-page?projectId=xxx&slug=home
 * Diagnostic: dumps the RAW stored draft page — html length, whether it contains
 * the hero, and whether it has a stale `blocks` field (and if those blocks contain
 * the hero). Helps diagnose why the builder shows different content than the data.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId')
  const slug = req.nextUrl.searchParams.get('slug') || 'home'
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const supabase = getSupabase()
  const { data, error } = await supabase.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const config = (data.site_config ?? {}) as Record<string, unknown>
  const pages = (config.pages as Array<{ slug: string; html: string; blocks?: Array<{ html?: string }> }>) ?? []
  const p = pages.find(x => x.slug === slug)
  if (!p) return NextResponse.json({ error: `page "${slug}" not found` }, { status: 404 })

  const html = p.html ?? ''
  const blocks = p.blocks
  const blocksHtml = Array.isArray(blocks) ? blocks.map(b => b.html ?? '').join('') : ''

  // ?dump=1 → return raw html + shared nav/footer (base64) to reproduce injectBase client-side
  if (req.nextUrl.searchParams.get('dump') === '1') {
    return NextResponse.json({
      html_b64: Buffer.from(html).toString('base64'),
      shared_nav_b64: Buffer.from((config.shared_nav_html as string) ?? '').toString('base64'),
      shared_footer_b64: Buffer.from((config.shared_footer_html as string) ?? '').toString('base64'),
    })
  }

  return NextResponse.json({
    slug,
    html: {
      length: html.length,
      hasHero: html.includes('class="hero"'),
      hasBadge: html.includes('SIN TARJETA'),
      hasH1: /<h1/i.test(html),
      hasBase: /<base/i.test(html),
      hasEditorMarkers: /fact-edit|contenteditable|html-change/i.test(html),
    },
    blocks: blocks == null ? 'NESSUN campo blocks' : {
      count: Array.isArray(blocks) ? blocks.length : 'non-array',
      totalLength: blocksHtml.length,
      hasHero: blocksHtml.includes('class="hero"'),
      hasBadge: blocksHtml.includes('SIN TARJETA'),
    },
  })
}
