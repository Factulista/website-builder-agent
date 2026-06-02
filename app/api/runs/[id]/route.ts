import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { updateRunHtmlChanged } from '../../../../lib/agents/run-logger'

export const runtime = 'nodejs'

/**
 * PATCH /api/runs/[id]
 * Body: { html_changed: boolean }
 *
 * Called client-side after the editor applies the agent's edits and discovers
 * whether the page HTML actually changed. Updates output_data.html_changed so
 * the back-office can distinguish "success with changes" from "success with no changes".
 *
 * Auth: user Bearer token. Only the run owner (user_id) may patch their own run.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: runId } = await params
  if (!runId) return Response.json({ error: 'Missing run id' }, { status: 400 })

  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { html_changed?: boolean }
  if (typeof body.html_changed !== 'boolean') {
    return Response.json({ error: 'html_changed must be a boolean' }, { status: 400 })
  }

  // Ownership check: run must belong to this user
  const { data: run } = await supabase
    .from('agent_runs')
    .select('user_id')
    .eq('id', runId)
    .single()

  if (!run || run.user_id !== user.id) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  await updateRunHtmlChanged(runId, body.html_changed)
  return Response.json({ ok: true })
}
