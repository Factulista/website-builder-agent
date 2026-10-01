/**
 * POST /api/internal/pages-store-selftest?userId=xxx
 * Live self-test of lib/pages-store on two SCRATCH projects (created and hard-deleted
 * here, owned by `userId`, slug `zz-pages-selftest-*`) — never touches a real project.
 * Checks: order preserved, blocks stripped, other site_config keys untouched, shared
 * nav/footer handling, publish, update, whole-site loads, duplicate copy.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireInternalSecret } from '../../../../lib/api-auth'
import {
  readPages, readAllPages, readPage, writePages, updatePages, publishDrafts, copyAllPages, loadSiteWithPages,
} from '../../../../lib/pages-store'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr
  const userId = req.nextUrl.searchParams.get('userId')
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const stamp = Date.now()
  const checks: Record<string, boolean> = {}
  const ids: string[] = []
  const mk = async (suffix: string, site_config: unknown) => {
    const { data, error } = await sb.from('projects')
      .insert({ name: `pages selftest ${suffix}`, slug: `zz-pages-selftest-${stamp}-${suffix}`, user_id: userId, site_config })
      .select('id').single()
    if (error || !data) throw new Error(`insert failed: ${error?.message}`)
    ids.push(data.id)
    return data.id as string
  }
  try {
    const A = { slug: 'home', name: 'Home', html: '<nav>N1</nav><main>A</main><footer>F1</footer>', inMenu: true, blocks: [{ id: 'x' }] }
    const B = { slug: 'precios', name: 'Precios', html: '<main>B</main>', megaMenu: 'x', seo: { t: 1 } }
    const id = await mk('a', { pages: [A, B], published_pages: [{ slug: 'old', html: 'old' }], keep: { deep: 1 }, shared_nav_html: 'NAV0' })

    const d0 = await readPages(sb, id, 'draft')
    checks.readDraft = d0.length === 2 && d0[0].slug === 'home'
    checks.readPage = (await readPage(sb, id, 'precios', 'draft'))?.megaMenu === 'x'

    // reorder + blocks + shared nav untouched when null
    await writePages(sb, id, 'draft', [B, A])
    const d1 = await readPages(sb, id, 'draft')
    checks.orderPreserved = d1.map(p => p.slug).join() === 'precios,home'
    checks.blocksStripped = d1.every(p => !('blocks' in p))
    checks.fieldsPreserved = d1[0].megaMenu === 'x' && JSON.stringify(d1[0].seo) === '{"t":1}' && d1[1].inMenu === true
    const raw1 = (await sb.from('projects').select('site_config').eq('id', id).single()).data?.site_config as Record<string, unknown>
    checks.otherKeysKept = JSON.stringify(raw1.keep) === '{"deep":1}' && raw1.shared_nav_html === 'NAV0'
      && (raw1.published_pages as unknown[]).length === 1

    // shared nav/footer written when passed
    await writePages(sb, id, 'draft', [A, B], { nav: '<nav>N2</nav>', footer: null })
    const raw2 = (await sb.from('projects').select('site_config').eq('id', id).single()).data?.site_config as Record<string, unknown>
    checks.sharedNavWritten = raw2.shared_nav_html === '<nav>N2</nav>' && !('shared_footer_html' in raw2 && raw2.shared_footer_html)

    // publish
    const n = await publishDrafts(sb, id)
    const all = await readAllPages(sb, id)
    checks.publish = n === 2 && all.published.map(p => p.slug).join() === 'home,precios' && all.published.every(p => !('blocks' in p))

    // update (remove one published page)
    await updatePages(sb, id, 'published', ps => ps.filter(p => p.slug !== 'precios'))
    checks.update = (await readPages(sb, id, 'published')).map(p => p.slug).join() === 'home'
    // no-op update must not write
    const before = (await sb.from('projects').select('updated_at').eq('id', id).single()).data?.updated_at
    await updatePages(sb, id, 'draft', ps => ps)
    const after = (await sb.from('projects').select('updated_at').eq('id', id).single()).data?.updated_at
    checks.noopNoWrite = before === after

    // whole-site loads
    const draftSite = await loadSiteWithPages(sb, { id }, 'draft')
    const pubSite = await loadSiteWithPages(sb, { id }, 'published', ['custom_domain_status'])
    checks.loadDraft = !!draftSite && Array.isArray(draftSite.config.pages) && !('published_pages' in draftSite.config)
      && JSON.stringify(draftSite.config.keep) === '{"deep":1}'
    checks.loadPublished = !!pubSite && Array.isArray(pubSite.config.published_pages) && !('pages' in pubSite.config)
      && 'custom_domain_status' in pubSite.project

    // duplicate
    const id2 = await mk('b', { keep: { deep: 2 } })
    await copyAllPages(sb, id, id2)
    const all2 = await readAllPages(sb, id2)
    checks.copy = all2.draft.map(p => p.slug).join() === 'home,precios' && all2.published.map(p => p.slug).join() === 'home'

    // empty project reads as []
    const id3 = await mk('c', null)
    checks.emptyIsEmpty = (await readPages(sb, id3, 'draft')).length === 0
  } catch (e) {
    checks.noException = false
    return NextResponse.json({ pass: false, checks, error: String(e) }, { status: 500 })
  } finally {
    if (ids.length) await sb.from('projects').delete().in('id', ids)
  }
  return NextResponse.json({ pass: Object.values(checks).every(Boolean), checks })
}
