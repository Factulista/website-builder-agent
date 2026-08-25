/**
 * POST /api/internal/rename-page-slug
 * Body: { projectId, renames: [{ from, to, ogTitle?, title? }] }
 *
 * Renames DRAFT pages (site_config.pages) and keeps their self-referencing SEO
 * metadata in sync, in a single read-modify-write:
 *   1. page.slug: from → to
 *   2. <link rel="canonical"> and og:url: {{site_url}}/from → {{site_url}}/to
 *      (og:url MUST follow the slug or it points at a 404)
 *   3. og:title / <title>, when provided
 *
 * Reports any page that also exists in published_pages, since renaming the draft
 * alone would leave the live copy on the old slug — the caller decides what to do.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireInternalSecret } from '../../../../lib/api-auth'

export const runtime = 'nodejs'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function retargetSelfUrls(html: string, from: string, to: string): string {
  // Only rewrite self-references built on the {{site_url}} placeholder, so we never
  // touch links pointing at other pages that merely share a prefix.
  return html.replace(
    new RegExp(`\\{\\{site_url\\}\\}/${escapeRe(from)}(?=["'\\s>])`, 'g'),
    `{{site_url}}/${to}`
  )
}

function setMetaContent(html: string, property: string, value: string): string {
  const re = new RegExp(`(<meta[^>]*property=["']${escapeRe(property)}["'][^>]*content=["'])[^"']*(["'])`, 'i')
  return re.test(html) ? html.replace(re, `$1${value}$2`) : html
}

function setTitle(html: string, value: string): string {
  return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${value}</title>`)
}

export async function POST(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr

  const body = await req.json().catch(() => null)
  const projectId = body?.projectId as string | undefined
  const renames = (body?.renames ?? []) as Array<{ from: string; to: string; ogTitle?: string; title?: string }>
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  if (!renames.length) return NextResponse.json({ error: 'renames required' }, { status: 400 })

  const supabase = getSupabase()
  const { data, error } = await supabase.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const config = (data.site_config ?? {}) as Record<string, unknown>
  const pages = (config.pages as Array<Record<string, unknown>>) ?? []
  const published = (config.published_pages as Array<Record<string, unknown>>) ?? []
  const publishedSlugs = new Set(published.map(p => p.slug as string))

  const applied: string[] = []
  const skipped: string[] = []
  const alsoPublished: string[] = []
  const collisions: string[] = []

  const draftSlugs = new Set(pages.map(p => p.slug as string))

  for (const r of renames) {
    if (!r.from || !r.to) continue
    const page = pages.find(p => p.slug === r.from)
    if (!page) { skipped.push(`${r.from} (non trovata)`); continue }
    if (draftSlugs.has(r.to)) { collisions.push(`${r.to} (slug già esistente)`); continue }
    if (publishedSlugs.has(r.from)) alsoPublished.push(r.from)

    let html = (page.html as string) ?? ''
    html = retargetSelfUrls(html, r.from, r.to)
    if (r.ogTitle) html = setMetaContent(html, 'og:title', r.ogTitle)
    if (r.title) html = setTitle(html, r.title)

    page.html = html
    page.slug = r.to
    // Stale block cache would still carry the old markup — drop it.
    delete page.blocks
    draftSlugs.delete(r.from)
    draftSlugs.add(r.to)
    applied.push(`${r.from} → ${r.to}`)
  }

  if (!applied.length) {
    return NextResponse.json({ message: 'Nessuna rinomina applicata', skipped, collisions })
  }

  const { error: saveErr } = await supabase
    .from('projects')
    .update({ site_config: { ...config, pages }, updated_at: new Date().toISOString() })
    .eq('id', projectId)
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })

  return NextResponse.json({ message: 'Rinomine applicate (draft)', applied, skipped, collisions, alsoPublished })
}
