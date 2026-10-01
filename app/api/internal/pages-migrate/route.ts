/**
 * POST /api/internal/pages-migrate  Body: { projectId, to: 'table' | 'config' }
 * Flips a project's page storage (phase 2.2 — see supabase/migrations/20261004_site_pages.sql).
 * 'table'  : copies site_config.pages/published_pages into site_pages, verifies the copy
 *            rebuilds identical arrays, then switches (one transaction; aborts on mismatch).
 * 'config' : rollback — rewrites the arrays in site_config from the table (keeping every
 *            edit made in table mode) and switches back.
 * Snapshots are re-rendered afterwards (they should come out byte-identical).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireInternalSecret } from '../../../../lib/api-auth'
import { withSnapshotRegen } from '../../../../lib/published-snapshots'
export const runtime = 'nodejs'
export const maxDuration = 60

async function handlePOST(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr
  const body = await req.json().catch(() => null)
  const projectId = body?.projectId as string | undefined
  const to = body?.to as string | undefined
  if (!projectId || (to !== 'table' && to !== 'config')) {
    return NextResponse.json({ error: "projectId and to: 'table' | 'config' required" }, { status: 400 })
  }
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data, error } = await sb.rpc(to === 'table' ? 'pages_migrate_to_table' : 'pages_migrate_to_config', { p_id: projectId })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ result: data })
}

export const POST = withSnapshotRegen(handlePOST)
