/**
 * POST /api/internal/global-replace
 * Body: { projectId, replacements: [{ from, to }] }
 * Applies exact string replacements EVERYWHERE: all draft pages, all published pages,
 * shared_nav_html, shared_footer_html, shared_css. Clears stale blocks on changed pages.
 * Use for nav/footer text or shared component CSS that appears across the whole site.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { readAllPages, writePages } from '../../../../lib/pages-store'
import { patchSiteConfig, type SiteConfigSet } from '../../../../lib/site-config-patch'
import { requireInternalSecret } from '../../../../lib/api-auth'
import { withSnapshotRegen } from '../../../../lib/published-snapshots'

export const runtime = 'nodejs'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

async function handlePOST(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr

  const body = await req.json().catch(() => null)
  const projectId = body?.projectId as string | undefined
  const replacements = (body?.replacements as Array<{ from: string; to: string }> | undefined) ?? []
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  if (replacements.length === 0) return NextResponse.json({ error: 'no replacements' }, { status: 400 })

  const supabase = getSupabase()
  let all: Awaited<ReturnType<typeof readAllPages>>
  try { all = await readAllPages(supabase, projectId) } catch { return NextResponse.json({ error: 'project not found' }, { status: 404 }) }
  const { data, error } = await supabase.from('projects')
    .select('shared_nav_html:site_config->shared_nav_html, shared_footer_html:site_config->shared_footer_html, shared_css:site_config->shared_css')
    .eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })
  const config = data as Record<string, unknown>
  const applied: Record<string, number> = {}

  const applyToStr = (s: string): { out: string; changed: boolean } => {
    let out = s
    let changed = false
    for (const r of replacements) {
      if (!r.from) continue
      const count = out.split(r.from).length - 1
      if (count > 0) {
        out = out.split(r.from).join(r.to)
        applied[r.from] = (applied[r.from] ?? 0) + count
        changed = true
      }
    }
    return { out, changed }
  }

  const fixArr = (arr: Array<{ slug: string; html: string; blocks?: unknown }> | undefined) =>
    (arr ?? []).map(p => {
      const { out, changed } = applyToStr(p.html ?? '')
      return changed ? { ...p, html: out, blocks: undefined } : p
    })

  const fixedPages = fixArr(all.draft as Array<{ slug: string; html: string }>)
  const fixedPublished = fixArr(all.published as Array<{ slug: string; html: string }>)

  const sharedSets: SiteConfigSet[] = []
  for (const field of ['shared_nav_html', 'shared_footer_html', 'shared_css']) {
    if (typeof config[field] === 'string') {
      const { out, changed } = applyToStr(config[field] as string)
      if (changed) sharedSets.push({ path: [field], value: out })
    }
  }

  const totalApplied = Object.values(applied).reduce((a, b) => a + b, 0)
  if (totalApplied === 0) return NextResponse.json({ message: 'Nessuna corrispondenza trovata', applied })

  try {
    await writePages(supabase, projectId, 'draft', fixedPages)
    await writePages(supabase, projectId, 'published', fixedPublished)
    const { error: saveErr } = await patchSiteConfig(supabase, projectId, sharedSets)
    if (saveErr) throw new Error(saveErr)
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }

  return NextResponse.json({ message: 'Sostituzioni globali applicate (draft + live + shared)', applied })
}

// Re-render the project's published snapshots after a successful change.
export const POST = withSnapshotRegen(handlePOST)
