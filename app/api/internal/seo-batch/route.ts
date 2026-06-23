/**
 * POST /api/internal/seo-batch  (one-shot)
 * Body: { descriptions?: {slug:text}, blog_seo_title?, blog_seo_description?, projectId? }
 * - descriptions: replaces <meta name="description"> in pages + published_pages
 * - blog_seo_title / blog_seo_description: stored at site_config root (used by the blog list route)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
export const runtime = 'nodejs'

function setDescription(html: string, desc: string): { html: string; changed: boolean } {
  const esc = desc.replace(/"/g, '&quot;')
  let changed = false
  let out = html.replace(
    /(<meta[^>]+name=["']description["'][^>]*content=["'])[\s\S]*?(["'][^>]*>)/i,
    (_m, a, b) => { changed = true; return `${a}${esc}${b}` }
  )
  if (!changed) {
    out = html.replace(
      /(<meta[^>]+content=["'])[\s\S]*?(["'][^>]*name=["']description["'][^>]*>)/i,
      (_m, a, b) => { changed = true; return `${a}${esc}${b}` }
    )
  }
  return { html: out, changed }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'bad body' }, { status: 400 })
  const descriptions = (body.descriptions ?? {}) as Record<string, string>
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
      result[`${slug}:${label}`] = changed ? `updated (${desc.length})` : 'tag not found'
      return changed ? { ...p, html } : p
    })

  const nextCfg: Record<string, unknown> = { ...cfg }
  if (Object.keys(descriptions).length) {
    nextCfg.pages = apply((cfg.pages as Array<Record<string, unknown>>) ?? [], 'pages')
    nextCfg.published_pages = apply((cfg.published_pages as Array<Record<string, unknown>>) ?? [], 'published')
  }
  if (typeof body.blog_seo_title === 'string') { nextCfg.blog_seo_title = body.blog_seo_title; result['blog_seo_title'] = `set (${body.blog_seo_title.length})` }
  if (typeof body.blog_seo_description === 'string') { nextCfg.blog_seo_description = body.blog_seo_description; result['blog_seo_description'] = `set (${body.blog_seo_description.length})` }

  const { error: saveErr } = await sb.from('projects').update({
    site_config: { ...nextCfg, updated_at: undefined },
    updated_at: new Date().toISOString(),
  }).eq('id', projectId)
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, result })
}
