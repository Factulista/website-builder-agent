/**
 * POST /api/internal/publish-page
 * Body: { projectId, slug }
 * Copies a draft page (pages[]) into published_pages[], making it live.
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
  const slug = body?.slug as string | undefined
  if (!projectId || !slug) return NextResponse.json({ error: 'projectId and slug required' }, { status: 400 })
  const supabase = getSupabase()
  let all: Awaited<ReturnType<typeof readAllPages>>
  try { all = await readAllPages(supabase, projectId) } catch { return NextResponse.json({ error: 'project not found' }, { status: 404 }) }
  const pages = all.draft as Array<{slug:string;html?:string}>
  const draft = pages.find(p => p.slug === slug)
  if (!draft) return NextResponse.json({ error: `draft page "${slug}" not found` }, { status: 404 })
  const published = all.published as Array<{slug:string;html?:string}>
  const existing = published.findIndex(p => p.slug === slug)
  // Never copy the editor-only `blocks` cache into published_pages (see publish-project).
  const { blocks: _blocks, ...live } = draft as { slug: string; html?: string; blocks?: unknown }
  const updated = existing >= 0
    ? published.map((p, i) => i === existing ? { ...live } : p)
    : [...published, { ...live }]
  try { await writePages(supabase, projectId, 'published', updated) }
  catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
  return NextResponse.json({ message: `Page "${slug}" published (${draft.html?.length ?? 0} chars)` })
}

// Re-render the project's published snapshots after a successful change.
export const POST = withSnapshotRegen(handlePOST)
