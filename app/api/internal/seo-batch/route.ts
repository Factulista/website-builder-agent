/**
 * POST /api/internal/seo-batch  (one-shot)
 * Body: { descriptions?: {slug:text}, blog_descriptions?: {postSlug:text}, projectId? }
 * - descriptions: replaces <meta name="description"> in pages + published_pages
 * - blog_descriptions: updates blog_posts.seo_description by post slug
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
  const blogDescriptions = (body.blog_descriptions ?? {}) as Record<string, string>
  const projectId = (body.projectId as string) || '6a436817-7c0a-40ed-aa26-8aeffdc128f4'

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const result: Record<string, string> = {}

  // ── Pages (meta description inside HTML) ──
  if (Object.keys(descriptions).length) {
    const { data, error } = await sb.from('projects').select('site_config').eq('id', projectId).single()
    if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })
    const cfg = (data.site_config ?? {}) as Record<string, unknown>
    const apply = (list: Array<Record<string, unknown>>, label: string) =>
      list.map(p => {
        const slug = p.slug as string
        const desc = descriptions[slug]
        if (!desc) return p
        const { html, changed } = setDescription((p.html as string) ?? '', desc)
        result[`${slug}:${label}`] = changed ? `updated (${desc.length})` : 'tag not found'
        return changed ? { ...p, html } : p
      })
    const newPages = apply((cfg.pages as Array<Record<string, unknown>>) ?? [], 'pages')
    const newPub = apply((cfg.published_pages as Array<Record<string, unknown>>) ?? [], 'published')
    const { error: saveErr } = await sb.from('projects').update({
      site_config: { ...cfg, pages: newPages, published_pages: newPub },
      updated_at: new Date().toISOString(),
    }).eq('id', projectId)
    if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })
  }

  // ── Blog posts (seo_description column) ──
  for (const [slug, desc] of Object.entries(blogDescriptions)) {
    const { data, error } = await sb.from('blog_posts')
      .update({ seo_description: desc, updated_at: new Date().toISOString() })
      .eq('project_id', projectId).eq('slug', slug).select('id')
    result[`blog:${slug}`] = error ? `error: ${error.message}` : `updated (${desc.length}, ${data?.length ?? 0} row)`
  }

  return NextResponse.json({ ok: true, result })
}
