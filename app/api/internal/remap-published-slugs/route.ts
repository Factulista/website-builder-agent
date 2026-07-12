/**
 * POST /api/internal/remap-published-slugs
 * Body: { projectId, siteUrl?, mappings: [{ from, to }] }  (from = old published slug, to = new/long slug)
 *
 * For each mapping, atomically (single read-modify-write):
 *  1. Take the DRAFT page whose slug === `to` (source of truth: content, megaMenu…).
 *  2. Fix its <link rel="canonical"> and og:url to the SELF `to` URL.
 *  3. Upsert it into published_pages under slug `to`.
 *  4. Remove the stale published entry with slug `from`.
 *  5. Add a 301 redirect `/from` → `/to` (deduped).
 *  6. Also fix canonical/og:url on the draft copy so the builder SEO panel matches.
 *
 * Used to promote the comparativa pages from their old short published slugs to the
 * long keyword-rich slugs configured in the builder, without breaking existing links.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
export const runtime = 'nodejs'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

function fixSelfUrls(html: string, siteUrl: string, slug: string): string {
  const self = `${siteUrl}/${slug}`
  return html
    .replace(/(<link[^>]*rel="canonical"[^>]*href=")[^"]*(")/i, `$1${self}$2`)
    .replace(/(<meta[^>]*property="og:url"[^>]*content=")[^"]*(")/i, `$1${self}$2`)
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const projectId = body?.projectId as string | undefined
  const siteUrl = ((body?.siteUrl as string | undefined) ?? 'https://www.factulista.com').replace(/\/+$/, '')
  const mappings = (body?.mappings as Array<{ from: string; to: string }> | undefined) ?? []
  if (!projectId || !mappings.length) {
    return NextResponse.json({ error: 'projectId and mappings required' }, { status: 400 })
  }

  const supabase = getSupabase()
  const { data, error } = await supabase.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const config = (data.site_config ?? {}) as Record<string, unknown>
  const pages = (config.pages as Array<Record<string, unknown>>) ?? []
  const published = (config.published_pages as Array<Record<string, unknown>>) ?? []
  const redirects = (config.redirects as Array<{ from: string; to: string }>) ?? []

  const result: Record<string, string> = {}

  for (const { from, to } of mappings) {
    const draftIdx = pages.findIndex(p => p.slug === to)
    if (draftIdx === -1) { result[to] = 'DRAFT NOT FOUND — skipped'; continue }

    // 1+2. clone draft, fix self URLs
    const draft = { ...pages[draftIdx] }
    if (typeof draft.html === 'string') draft.html = fixSelfUrls(draft.html, siteUrl, to)
    pages[draftIdx] = { ...draft } // keep draft in sync (canonical/og:url)

    // 3. upsert into published under `to`
    const pubIdx = published.findIndex(p => p.slug === to)
    if (pubIdx >= 0) published[pubIdx] = { ...draft }
    else published.push({ ...draft })

    // 4. remove stale published entry `from`
    const staleIdx = published.findIndex(p => p.slug === from)
    if (staleIdx >= 0) published.splice(staleIdx, 1)

    // 5. redirect /from → /to (dedupe by normalized from)
    const fromPath = `/${from}`
    const toPath = `/${to}`
    const existingRedirect = redirects.findIndex(r => r.from && r.from.replace(/^\/+|\/+$/g, '') === from)
    if (existingRedirect >= 0) redirects[existingRedirect] = { from: fromPath, to: toPath }
    else redirects.push({ from: fromPath, to: toPath })

    result[to] = `published (self-canonical set) · removed /${from} · redirect added`
  }

  const { error: saveErr } = await supabase.from('projects').update({
    site_config: { ...config, pages, published_pages: published, redirects },
    updated_at: new Date().toISOString(),
  }).eq('id', projectId)
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })

  return NextResponse.json({ message: 'remap complete', result })
}
