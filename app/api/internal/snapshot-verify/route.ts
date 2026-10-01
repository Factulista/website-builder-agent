/**
 * GET /api/internal/snapshot-verify?projectSlug=factulista&host=www.factulista.com
 * Dry run, writes nothing: renders every published page twice — from the config the
 * snapshot generator uses (get_published_site) and from the one the live path uses
 * (get_published_page) — and reports any byte difference. Also compares what is
 * currently stored in published_snapshots (if any) against a fresh render.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { requireInternalSecret } from '../../../../lib/api-auth'
import { renderPublishedPageHtml } from '../../../../lib/preview'
export const runtime = 'nodejs'
export const maxDuration = 60

type Cfg = Parameters<typeof renderPublishedPageHtml>[0]
const sha = (s: string | null) => (s === null ? 'null' : createHash('sha256').update(s).digest('hex').slice(0, 16))

export async function GET(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr
  const projectSlug = req.nextUrl.searchParams.get('projectSlug') ?? ''
  const host = req.nextUrl.searchParams.get('host') ?? ''
  if (!projectSlug || !host) return NextResponse.json({ error: 'projectSlug and host required' }, { status: 400 })
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const full = await sb.rpc('get_published_site', { p_slug: projectSlug }).maybeSingle()
  if (full.error || !full.data) return NextResponse.json({ error: full.error?.message ?? 'no data' }, { status: 500 })
  const fullCfg = (full.data as { config: Cfg }).config
  const name = (full.data as { name: string | null }).name ?? ''
  const slugs = (fullCfg.published_pages ?? []).map(p => p.slug)

  const stored = await sb.from('published_snapshots').select('path, body').eq('project_slug', projectSlug).eq('host', host)
  const storedBy = new Map((stored.data ?? []).map(r => [r.path as string, r.body as string]))

  const mismatches: Array<{ slug: string; generator: string; live: string; stored?: string }> = []
  for (const slug of slugs) {
    const a = renderPublishedPageHtml(fullCfg, name, slug, host)
    const one = await sb.rpc('get_published_page', { p_slug: projectSlug, p_page: slug }).maybeSingle()
    const b = one.data ? renderPublishedPageHtml((one.data as { config: Cfg }).config, (one.data as { name: string | null }).name ?? '', slug, host) : null
    const st = storedBy.get(slug)
    if (a !== b || (st !== undefined && st !== a)) {
      mismatches.push({ slug, generator: sha(a), live: sha(b), ...(st !== undefined ? { stored: sha(st) } : {}) })
    }
  }
  return NextResponse.json({
    pages: slugs.length,
    storedSnapshots: storedBy.size,
    storedTableReadable: !stored.error,
    mismatches,
    pass: mismatches.length === 0,
  })
}
