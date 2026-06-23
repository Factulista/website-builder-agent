/**
 * POST /api/internal/set-meta-descriptions  (one-shot)
 * Body: { descriptions: { [slug]: string }, projectId? }
 * Replaces <meta name="description"> content for each given slug, in BOTH
 * site_config.pages and published_pages. Targeted regex on the description tag
 * only — no other HTML is touched.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
export const runtime = 'nodejs'

function setDescription(html: string, desc: string): { html: string; changed: boolean } {
  const esc = desc.replace(/"/g, '&quot;')
  let changed = false
  // name="description" ... content="..."
  let out = html.replace(
    /(<meta[^>]+name=["']description["'][^>]*content=["'])[\s\S]*?(["'][^>]*>)/i,
    (_m, a, b) => { changed = true; return `${a}${esc}${b}` }
  )
  if (!changed) {
    // content="..." ... name="description"
    out = html.replace(
      /(<meta[^>]+content=["'])[\s\S]*?(["'][^>]*name=["']description["'][^>]*>)/i,
      (_m, a, b) => { changed = true; return `${a}${esc}${b}` }
    )
  }
  return { html: out, changed }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const descriptions = body?.descriptions as Record<string, string> | undefined
  if (!descriptions || typeof descriptions !== 'object') {
    return NextResponse.json({ error: 'body must be { descriptions: { slug: text } }' }, { status: 400 })
  }
  const projectId = (body.projectId as string) || '6a436817-7c0a-40ed-aa26-8aeffdc128f4'

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data, error } = await sb.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const cfg = (data.site_config ?? {}) as Record<string, unknown>
  const result: Record<string, string> = {}

  const apply = (list: Array<Record<string, unknown>>, label: string) =>
    list.map(p => {
      const slug = p.slug as string
      const desc = descriptions[slug]
      if (!desc) return p
      const { html, changed } = setDescription((p.html as string) ?? '', desc)
      result[`${slug}:${label}`] = changed ? `updated (${desc.length} chars)` : 'tag not found'
      return changed ? { ...p, html } : p
    })

  const pages = apply((cfg.pages as Array<Record<string, unknown>>) ?? [], 'pages')
  const published = apply((cfg.published_pages as Array<Record<string, unknown>>) ?? [], 'published')

  const { error: saveErr } = await sb.from('projects').update({
    site_config: { ...cfg, pages, published_pages: published },
    updated_at: new Date().toISOString(),
  }).eq('id', projectId)
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, result })
}
