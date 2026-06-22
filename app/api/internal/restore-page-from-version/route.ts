/**
 * POST /api/internal/restore-page-from-version
 * Body: { slug, vid, newTitle?, newDescription?, projectId?, dryRun? }
 *
 * Reads pages[slug].html from the project_versions snapshot identified by vid,
 * optionally fixes <title> and <meta name="description">, and writes the result
 * to BOTH site_config.pages[slug] and published_pages[slug]. Pure recovery —
 * no structural HTML transforms beyond the optional title/description swap.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body.slug !== 'string' || typeof body.vid !== 'string') {
    return NextResponse.json({ error: 'body must be { slug, vid }' }, { status: 400 })
  }
  const { slug, vid } = body as { slug: string; vid: string }
  const newTitle = typeof body.newTitle === 'string' ? body.newTitle : null
  const newDescription = typeof body.newDescription === 'string' ? body.newDescription : null
  const projectId = (body.projectId as string) || '6a436817-7c0a-40ed-aa26-8aeffdc128f4'
  const dryRun = body.dryRun === true

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: vrow, error: vErr } = await sb
    .from('project_versions')
    .select('id, created_at, pages')
    .eq('id', vid)
    .single()
  if (vErr || !vrow) return NextResponse.json({ error: 'version not found' }, { status: 404 })

  const vpages = (vrow.pages as Array<Record<string, unknown>>) ?? []
  const snap = vpages.find(p => p.slug === slug)
  if (!snap?.html) return NextResponse.json({ error: 'slug not found in snapshot' }, { status: 404 })

  let html = snap.html as string
  if (html.length < 1000) return NextResponse.json({ error: 'snapshot html too short', len: html.length }, { status: 400 })

  if (newTitle) {
    html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${newTitle}</title>`)
  }
  if (newDescription) {
    html = html.replace(/(<meta[^>]+name=["']description["'][^>]+content=["'])[\s\S]*?(["'])/i, `$1${newDescription}$2`)
  }

  const summary = {
    title: (html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim(),
    sections: (html.match(/<section[^>]*>/g) ?? []).length,
    hasFaq: /class="faq"/.test(html),
    htmlLen: html.length,
  }

  if (dryRun) return NextResponse.json({ dryRun: true, fromVersion: vrow.created_at, summary })

  const { data, error } = await sb.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })
  const cfg = (data.site_config ?? {}) as Record<string, unknown>
  const pages = (cfg.pages as Array<Record<string, unknown>>) ?? []
  const published = (cfg.published_pages as Array<Record<string, unknown>>) ?? []

  const result: Record<string, string> = {}
  const apply = (list: Array<Record<string, unknown>>, label: string) => {
    const idx = list.findIndex(p => p.slug === slug)
    if (idx === -1) { result[label] = 'slug not found'; return list }
    const next = [...list]
    const { blocks: _b, ...rest } = next[idx]
    void _b
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

  return NextResponse.json({ ok: true, slug, fromVersion: vrow.created_at, summary, result })
}
