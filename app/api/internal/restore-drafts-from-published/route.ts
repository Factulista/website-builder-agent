/**
 * POST /api/internal/restore-drafts-from-published
 * Body: { projectId, dryRun?: boolean, sharedFromHome?: boolean }
 * Recovery tool: draft pages := published pages (same pages, order and fields), and
 * optionally shared_nav_html / shared_footer_html := the published home page's own
 * <nav> / <footer>. Used after an accidental restore of an old version rewrote every
 * draft and the shared header. dryRun reports what would change and writes nothing.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireInternalSecret } from '../../../../lib/api-auth'
import { readAllPages, writePages } from '../../../../lib/pages-store'
import { patchSiteConfig } from '../../../../lib/site-config-patch'
import { withSnapshotRegen } from '../../../../lib/published-snapshots'
export const runtime = 'nodejs'
export const maxDuration = 60

const navOrder = (nav: string) => [...nav.matchAll(/<li[^>]*>\s*(?:<a[^>]*>([^<]+)<\/a>|<button[^>]*>([^<]+)<\/button>)/g)].map(m => (m[1] ?? m[2]).trim())

async function handlePOST(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr
  const body = await req.json().catch(() => null)
  const projectId = body?.projectId as string | undefined
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const all = await readAllPages<{ slug: string; html?: string }>(sb, projectId)
  if (all.published.length === 0) return NextResponse.json({ error: 'no published pages' }, { status: 400 })
  const { data: cfg } = await sb.from('projects')
    .select('nav:site_config->shared_nav_html, footer:site_config->shared_footer_html').eq('id', projectId).single()
  const cur = (cfg ?? {}) as { nav?: string | null; footer?: string | null }
  const home = all.published.find(p => p.slug === 'home') ?? all.published[0]
  const homeNav = home?.html?.match(/<nav[\s\S]*?<\/nav>/i)?.[0] ?? null
  const homeFooter = home?.html?.match(/<footer[\s\S]*?<\/footer>/i)?.[0] ?? null
  const pubBySlug = new Map(all.published.map(p => [p.slug, p]))
  const report = {
    drafts: all.draft.length,
    published: all.published.length,
    draftsDifferent: all.draft.filter(d => JSON.stringify(d) !== JSON.stringify(pubBySlug.get(d.slug))).length,
    draftOnly: all.draft.filter(d => !pubBySlug.has(d.slug)).map(d => d.slug),
    currentNavOrder: cur.nav ? navOrder(cur.nav) : null,
    publishedHomeNavOrder: homeNav ? navOrder(homeNav) : null,
    navDiffers: !!homeNav && homeNav !== cur.nav,
    footerDiffers: !!homeFooter && homeFooter !== cur.footer,
  }
  if (body?.dryRun) return NextResponse.json({
    dryRun: true, report,
    currentNav_b64: Buffer.from(cur.nav ?? '').toString('base64'),
    publishedHomeNav_b64: Buffer.from(homeNav ?? '').toString('base64'),
  })
  await writePages(sb, projectId, 'draft', all.published)
  if (body?.sharedFromHome) {
    const sets = []
    if (homeNav) sets.push({ path: ['shared_nav_html'], value: homeNav })
    if (homeFooter) sets.push({ path: ['shared_footer_html'], value: homeFooter })
    const { error } = await patchSiteConfig(sb, projectId, sets)
    if (error) return NextResponse.json({ error }, { status: 500 })
  }
  return NextResponse.json({ restored: true, report })
}

export const POST = withSnapshotRegen(handlePOST)
