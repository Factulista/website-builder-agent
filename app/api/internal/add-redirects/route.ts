/**
 * POST /api/internal/add-redirects
 * Body: { projectId, redirects: [{ from, to }] }   (from = old path, to = path or full URL)
 * Upserts entries into config.redirects (same list as SEO Optimizer → Strumenti),
 * matched by normalized `from`: an existing source gets its target replaced.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { patchSiteConfig } from '../../../../lib/site-config-patch'
import { requireInternalSecret } from '../../../../lib/api-auth'
import { withSnapshotRegen } from '../../../../lib/published-snapshots'
export const runtime = 'nodejs'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

const norm = (s: string) => s.trim().replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+|\/+$/g, '')

async function handlePOST(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr

  const body = await req.json().catch(() => null)
  const projectId = body?.projectId as string | undefined
  const incoming = ((body?.redirects as Array<{ from: string; to: string }> | undefined) ?? []).filter(r => r?.from && r?.to)
  if (!projectId || !incoming.length) return NextResponse.json({ error: 'projectId and redirects[] required' }, { status: 400 })

  const supabase = getSupabase()
  const { data, error } = await supabase.from('projects').select('redirects:site_config->redirects').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const config = (data ?? {}) as Record<string, unknown>
  const redirects = [...((config.redirects as Array<{ from: string; to: string }>) ?? [])]
  let added = 0, updated = 0
  for (const r of incoming) {
    const entry = { from: '/' + norm(r.from), to: r.to.trim() }
    const i = redirects.findIndex(x => x.from && norm(x.from) === norm(entry.from))
    if (i >= 0) { redirects[i] = entry; updated++ } else { redirects.push(entry); added++ }
  }

  const { error: saveErr } = await patchSiteConfig(supabase, projectId, [{ path: ['redirects'], value: redirects }])
  if (saveErr) return NextResponse.json({ error: saveErr }, { status: 500 })

  return NextResponse.json({ ok: true, added, updated, total: redirects.length })
}

// Re-render the project's published snapshots after a successful change.
export const POST = withSnapshotRegen(handlePOST)
