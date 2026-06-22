/**
 * POST /api/internal/set-page-html
 * Body: { slug: string, html: string, projectId?: string }
 *
 * Writes the given HTML to BOTH site_config.pages[slug] and
 * site_config.published_pages[slug] for the project. Pure assignment —
 * it does NOT transform or strip the HTML in any way. Used to restore /
 * update a single page safely, one at a time.
 *
 * IMPORTANT (live-edit gotcha): after this writes to the DB, the open builder
 * still holds the OLD page in memory. The user MUST hard-refresh the builder
 * before editing that page, or the next autosave overwrites this fix.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body.slug !== 'string' || typeof body.html !== 'string') {
    return NextResponse.json({ error: 'body must be { slug, html }' }, { status: 400 })
  }
  const slug = body.slug as string
  const html = body.html as string
  const projectId = (body.projectId as string) || '6a436817-7c0a-40ed-aa26-8aeffdc128f4'

  if (html.length < 500) {
    return NextResponse.json({ error: 'html too short — refusing to write', len: html.length }, { status: 400 })
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data, error } = await sb.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const cfg = (data.site_config ?? {}) as Record<string, unknown>
  const pages = (cfg.pages as Array<Record<string, unknown>>) ?? []
  const published = (cfg.published_pages as Array<Record<string, unknown>>) ?? []

  const result: Record<string, string> = {}

  const apply = (list: Array<Record<string, unknown>>, label: string) => {
    const idx = list.findIndex(p => p.slug === slug)
    if (idx === -1) {
      result[label] = 'slug not found — left untouched'
      return list
    }
    const next = [...list]
    // Drop stale `blocks` so the builder re-splits from the fresh html on load
    const { blocks: _blocks, ...rest } = next[idx]
    void _blocks
    next[idx] = { ...rest, html }
    result[label] = `written (${html.length} chars)`
    return next
  }

  const newPages = apply(pages, 'pages')
  const newPublished = apply(published, 'published_pages')

  const { error: saveErr } = await sb.from('projects').update({
    site_config: { ...cfg, pages: newPages, published_pages: newPublished },
    updated_at: new Date().toISOString(),
  }).eq('id', projectId)

  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })
  return NextResponse.json({ ok: true, slug, result })
}
