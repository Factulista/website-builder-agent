/**
 * POST /api/snapshots/regenerate   body: { projectId }
 * Re-renders a project's published pages into published_snapshots (lib/published-snapshots.ts).
 * Auth: the project owner (Bearer session token) or the internal secret (repair tools/cron).
 * Called by the builder after changes that affect the published output, by publish-project
 * and by internal tools; also safe to call any time (idempotent).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireUserAndProjectOwnership, jsonError } from '../../../../lib/api-auth'
import { regeneratePublishedSnapshots } from '../../../../lib/published-snapshots'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const projectId = body?.projectId as string | undefined
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const internal = !!process.env.INTERNAL_API_SECRET && req.headers.get('x-internal-secret') === process.env.INTERNAL_API_SECRET
  if (!internal) {
    try { await requireUserAndProjectOwnership(req, projectId) } catch (err) { return jsonError(err) as NextResponse }
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const result = await regeneratePublishedSnapshots(supabase, projectId)
  if (!result.ok) console.error('[snapshots] regenerate failed:', result.error)
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
