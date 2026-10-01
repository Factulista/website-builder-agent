/**
 * POST /api/internal/replace-in-page
 * Body: { projectId, slug, replacements: [{ from, to }] }
 * Applies exact string replacements (e.g. swap placeholder image URLs for real ones)
 * in a page's HTML — both draft (pages) and live (published_pages). Clears stale blocks.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { readAllPages, writePages } from '../../../../lib/pages-store'
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
  const slug = (body?.slug as string | undefined) ?? 'home'
  const replacements = (body?.replacements as Array<{ from: string; to: string }> | undefined) ?? []
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  if (replacements.length === 0) return NextResponse.json({ error: 'no replacements' }, { status: 400 })

  const supabase = getSupabase()
  let all: Awaited<ReturnType<typeof readAllPages>>
  try { all = await readAllPages(supabase, projectId) } catch { return NextResponse.json({ error: 'project not found' }, { status: 404 }) }
  const applied: Record<string, number> = {}

  const fixArr = (arr: Array<{ slug: string; html: string; blocks?: unknown }> | undefined) =>
    (arr ?? []).map(p => {
      if (p.slug !== slug) return p
      let html = p.html ?? ''
      let pageChanged = false
      for (const r of replacements) {
        if (!r.from || !r.to) continue
        const count = html.split(r.from).length - 1
        if (count > 0) {
          html = html.split(r.from).join(r.to)
          applied[r.from] = (applied[r.from] ?? 0) + count
          pageChanged = true
        }
      }
      return pageChanged ? { ...p, html, blocks: undefined } : p
    })

  const fixedPages = fixArr(all.draft as Array<{ slug: string; html: string }>)
  const fixedPublished = fixArr(all.published as Array<{ slug: string; html: string }>)

  const totalApplied = Object.values(applied).reduce((a, b) => a + b, 0)
  if (totalApplied === 0) return NextResponse.json({ message: 'Nessuna corrispondenza trovata', applied })

  try {
    await writePages(supabase, projectId, 'draft', fixedPages)
    await writePages(supabase, projectId, 'published', fixedPublished)
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }

  return NextResponse.json({ message: `Sostituzioni applicate su "${slug}" (draft + live)`, applied })
}

// Re-render the project's published snapshots after a successful change.
export const POST = withSnapshotRegen(handlePOST)
