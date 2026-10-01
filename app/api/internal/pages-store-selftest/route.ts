/**
 * POST /api/internal/pages-store-selftest?userId=xxx
 * Live self-test of lib/pages-store on two SCRATCH projects (created and hard-deleted
 * here, owned by `userId`, slug `zz-pages-selftest-*`) — never touches a real project.
 * Checks: order preserved, blocks stripped, other site_config keys untouched, shared
 * nav/footer handling, publish, update, whole-site loads, duplicate copy — once with
 * pages in site_config and, if the 20261004 migration is installed, once with pages in
 * the site_pages table (plus the switch round-trip and the public get_* functions).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { requireInternalSecret } from '../../../../lib/api-auth'
import {
  readPages, readAllPages, readPage, writePages, updatePages, publishDrafts, copyAllPages, loadSiteWithPages,
} from '../../../../lib/pages-store'
export const runtime = 'nodejs'

type Sb = SupabaseClient

async function runChecks(sb: Sb, userId: string, mode: 'config' | 'table', ids: string[]): Promise<Record<string, boolean>> {
  const stamp = Date.now()
  const checks: Record<string, boolean> = {}
  const mk = async (suffix: string, site_config: unknown) => {
    const { data, error } = await sb.from('projects')
      .insert({ name: `pages selftest ${suffix}`, slug: `zz-pages-selftest-${stamp}-${mode}-${suffix}`, user_id: userId, site_config })
      .select('id, slug').single()
    if (error || !data) throw new Error(`insert failed: ${error?.message}`)
    ids.push(data.id)
    if (mode === 'table') {
      const m = await sb.rpc('pages_migrate_to_table', { p_id: data.id })
      if (m.error) throw new Error(`migrate failed: ${m.error.message}`)
    }
    return data as { id: string; slug: string }
  }
  const A = { slug: 'home', name: 'Home', html: '<nav>N1</nav><main>A</main><footer>F1</footer>', inMenu: true, blocks: [{ id: 'x' }] }
  const B = { slug: 'precios', name: 'Precios', html: '<main>B</main>', megaMenu: 'x', seo: { t: 1 }, nullField: null }
  const { id, slug } = await mk('a', { pages: [A, B], published_pages: [{ slug: 'old', html: 'old' }], keep: { deep: 1 }, shared_nav_html: 'NAV0' })
  const raw = async () => (await sb.from('projects').select('site_config').eq('id', id).single()).data?.site_config as Record<string, unknown>

  const d0 = await readPages(sb, id, 'draft')
  checks.readDraft = d0.length === 2 && d0[0].slug === 'home' && !('blocks' in d0[0])
  checks.readPage = (await readPage(sb, id, 'precios', 'draft'))?.megaMenu === 'x'

  await writePages(sb, id, 'draft', [B, A])
  const d1 = await readPages(sb, id, 'draft')
  checks.orderPreserved = d1.map(p => p.slug).join() === 'precios,home'
  checks.blocksStripped = d1.every(p => !('blocks' in p))
  checks.fieldsPreserved = d1[0].megaMenu === 'x' && JSON.stringify(d1[0].seo) === '{"t":1}' && d1[0].nullField === null && d1[1].inMenu === true
  const raw1 = await raw()
  checks.otherKeysKept = JSON.stringify(raw1.keep) === '{"deep":1}' && raw1.shared_nav_html === 'NAV0'
  checks.publishedUntouched = (await readPages(sb, id, 'published')).map(p => p.slug).join() === 'old'

  await writePages(sb, id, 'draft', [A, B], { nav: '<nav>N2</nav>', footer: null })
  const raw2 = await raw()
  checks.sharedNavWritten = raw2.shared_nav_html === '<nav>N2</nav>' && !raw2.shared_footer_html

  const n = await publishDrafts(sb, id)
  const all = await readAllPages(sb, id)
  checks.publish = n === 2 && all.published.map(p => p.slug).join() === 'home,precios' && all.published.every(p => !('blocks' in p))

  // Public read path (SECURITY DEFINER functions) sees the same pages
  const site = await sb.rpc('get_published_site', { p_slug: slug }).maybeSingle()
  const pub = ((site.data as { config?: { published_pages?: Array<{ slug: string; html?: string }> } } | null)?.config?.published_pages) ?? []
  checks.publicSite = pub.map(p => p.slug).join() === 'home,precios' && pub[1]?.html === '<main>B</main>'
  const one = await sb.rpc('get_published_page', { p_slug: slug, p_page: 'precios' }).maybeSingle()
  const onePages = ((one.data as { config?: { published_pages?: Array<{ slug: string; html?: string }> } } | null)?.config?.published_pages) ?? []
  checks.publicPage = onePages.length === 2 && onePages[0].html === undefined && onePages[1].html === '<main>B</main>'
  const lite = await sb.rpc('get_site_config_lite', { p_slug: slug, p_html_slug: 'home' }).maybeSingle()
  const litePages = ((lite.data as { config?: { pages?: Array<{ slug: string; html?: string }> } } | null)?.config?.pages) ?? []
  checks.liteShell = litePages.length === 2 && !!litePages[0].html && litePages[1].html === undefined

  await updatePages(sb, id, 'published', ps => ps.filter(p => p.slug !== 'precios'))
  checks.update = (await readPages(sb, id, 'published')).map(p => p.slug).join() === 'home'
  const before = (await sb.from('projects').select('updated_at').eq('id', id).single()).data?.updated_at
  await updatePages(sb, id, 'draft', ps => ps)
  const after = (await sb.from('projects').select('updated_at').eq('id', id).single()).data?.updated_at
  checks.noopNoWrite = before === after

  const draftSite = await loadSiteWithPages(sb, { id }, 'draft')
  const pubSite = await loadSiteWithPages(sb, { id }, 'published', ['custom_domain_status'])
  checks.loadDraft = !!draftSite && (draftSite.config.pages as unknown[])?.length === 2 && !('published_pages' in draftSite.config)
    && JSON.stringify(draftSite.config.keep) === '{"deep":1}'
  checks.loadPublished = !!pubSite && (pubSite.config.published_pages as unknown[])?.length === 1 && !('pages' in pubSite.config)
    && 'custom_domain_status' in pubSite.project

  const b = await mk('b', { keep: { deep: 2 } })
  await copyAllPages(sb, id, b.id)
  const all2 = await readAllPages(sb, b.id)
  checks.copy = all2.draft.map(p => p.slug).join() === 'home,precios' && all2.published.map(p => p.slug).join() === 'home'

  const c = await mk('c', null)
  checks.emptyIsEmpty = (await readPages(sb, c.id, 'draft')).length === 0

  if (mode === 'table') {
    // Old builder tabs: save_inline_pages must land in the table too
    await sb.rpc('save_inline_pages', { p_id: id, p_pages: [B] })
    checks.legacySaveInTable = (await readPages(sb, id, 'draft')).map(p => p.slug).join() === 'precios'
    // Rollback: arrays rebuilt in site_config, edits kept
    const back = await sb.rpc('pages_migrate_to_config', { p_id: id })
    const raw3 = await raw()
    checks.rollback = !back.error && (raw3.pages as Array<{ slug: string }>).map(p => p.slug).join() === 'precios'
      && (raw3.published_pages as Array<{ slug: string }>).map(p => p.slug).join() === 'home'
      && (await readPages(sb, id, 'draft')).map(p => p.slug).join() === 'precios'
  }
  return checks
}

export async function POST(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr
  const userId = req.nextUrl.searchParams.get('userId')
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const probe = await sb.rpc('pages_read', { p_id: '00000000-0000-0000-0000-000000000000', p_state: 'draft' })
  const tableInstalled = !(probe.error && (probe.error.code === 'PGRST202' || /could not find the function/i.test(probe.error.message)))
  const ids: string[] = []
  const result: Record<string, Record<string, boolean>> = {}
  try {
    result.config = await runChecks(sb, userId, 'config', ids)
    if (tableInstalled) result.table = await runChecks(sb, userId, 'table', ids)
  } catch (e) {
    return NextResponse.json({ pass: false, tableInstalled, result, error: String(e) }, { status: 500 })
  } finally {
    if (ids.length) await sb.from('projects').delete().in('id', ids)
  }
  const pass = Object.values(result).every(r => Object.values(r).every(Boolean))
  return NextResponse.json({ pass, tableInstalled, result })
}
