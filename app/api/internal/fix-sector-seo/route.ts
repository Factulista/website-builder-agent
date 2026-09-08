/**
 * POST /api/internal/fix-sector-seo
 * Body: { projectId, pages: [{ slug, ogTitle, jsonLd }] }
 * One-off: for each given DRAFT page (site_config.pages), (1) sets og:title to match
 * the <title> tag exactly (house convention — see the comparativa pages), and
 * (2) injects a JSON-LD <script> before </head> if the page has none yet.
 * Draft only — these pages are intentionally kept unpublished.
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
  const items = (body?.pages as Array<{ slug: string; ogTitle: string; jsonLd: string }> | undefined) ?? []
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  if (!items.length) return NextResponse.json({ error: 'pages required' }, { status: 400 })

  const supabase = getSupabase()
  const { data, error } = await supabase.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const config = (data.site_config ?? {}) as Record<string, unknown>
  const pages = (config.pages as Array<{ slug: string; html: string; blocks?: unknown }>) ?? []
  const bySlug = new Map(items.map(i => [i.slug, i]))

  const results: Record<string, string> = {}
  let changed = false

  for (const p of pages) {
    const item = bySlug.get(p.slug)
    if (!item) continue
    let html = p.html ?? ''
    const before = html

    // 1. og:title -> exact match with <title>
    const ogTitleRe = /(<meta property="og:title" content=")[^"]*(")/
    if (ogTitleRe.test(html)) {
      html = html.replace(ogTitleRe, `$1${item.ogTitle}$2`)
    }

    // 2. JSON-LD: only inject if the page doesn't already have one
    if (!/application\/ld\+json/.test(html) && item.jsonLd) {
      const script = `<script type="application/ld+json">${item.jsonLd}</script>\n</head>`
      if (html.includes('</head>')) {
        html = html.replace('</head>', script)
      }
    }

    if (html !== before) {
      p.html = html
      delete (p as { blocks?: unknown }).blocks
      changed = true
      results[p.slug] = 'updated'
    } else {
      results[p.slug] = 'no change'
    }
  }

  if (!changed) return NextResponse.json({ message: 'Nessuna modifica applicata', results })

  const { error: saveErr } = await supabase.from('projects').update({
    site_config: { ...config, pages },
    updated_at: new Date().toISOString(),
  }).eq('id', projectId)
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })

  return NextResponse.json({ message: `SEO sistemato su ${Object.values(results).filter(r => r === 'updated').length} pagine`, results })
}
