/**
 * POST /api/internal/version-diag?projectId=xxx&userId=yyy
 * Why weren't versions saved after 2026-09-08? (1) legacy full-copy insert of the
 * project's current drafts into a SCRATCH project (deleted afterwards) — reports the
 * error/size; (2) a deduplicated version of the real project via version_create
 * (a fresh, good restore point).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireInternalSecret } from '../../../../lib/api-auth'
import { readPages } from '../../../../lib/pages-store'
import { createVersionDedup, loadKnownHtmlHashes } from '../../../../lib/versions-store'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr
  const projectId = req.nextUrl.searchParams.get('projectId')
  const userId = req.nextUrl.searchParams.get('userId')
  const summary = req.nextUrl.searchParams.get('summary') ?? 'Punto di ripristino'
  if (!projectId || !userId) return NextResponse.json({ error: 'projectId and userId required' }, { status: 400 })
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const pages = await readPages(sb, projectId, 'draft')
  const payloadBytes = Buffer.byteLength(JSON.stringify(pages))

  const { data: scratch } = await sb.from('projects').insert({ name: 'version diag', slug: `zz-version-diag-${Date.now()}`, user_id: userId }).select('id').single()
  let legacy: Record<string, unknown> = {}
  try {
    const t0 = Date.now()
    const { error } = await sb.from('project_versions').insert({ project_id: scratch!.id, summary: 'diag', pages }).select('id').single()
    legacy = { ok: !error, error: error?.message ?? null, code: error?.code ?? null, ms: Date.now() - t0 }
  } finally {
    await sb.from('projects').delete().eq('id', scratch!.id)
  }

  const t1 = Date.now()
  const known = await loadKnownHtmlHashes(sb, projectId)
  const created = await createVersionDedup(sb, projectId, summary, pages, known, 10).catch(e => ({ error: String(e) }))
  return NextResponse.json({ pages: pages.length, payloadBytes, legacy, dedup: { result: created, ms: Date.now() - t1, knownBefore: known.size } })
}
