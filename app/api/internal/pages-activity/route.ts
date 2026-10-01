/**
 * GET /api/internal/pages-activity?projectId=xxx   (read-only)
 * When were the stored pages last written? site_pages.updated_at per page/state,
 * plus projects.updated_at — to identify which session keeps writing.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireInternalSecret } from '../../../../lib/api-auth'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr
  const projectId = req.nextUrl.searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: rows } = await sb.from('site_pages').select('state, position, slug, updated_at').eq('project_id', projectId).order('updated_at', { ascending: false })
  const { data: proj } = await sb.from('projects').select('updated_at').eq('id', projectId).single()
  const { data: msgs } = await sb.from('projects').select('m:site_config->messages').eq('id', projectId).single()
  const messages = ((msgs as { m?: Array<{ role?: string; content?: string; timestamp?: string }> } | null)?.m ?? [])
  return NextResponse.json({
    projectUpdatedAt: proj?.updated_at,
    now: new Date().toISOString(),
    latestRows: (rows ?? []).slice(0, 12),
    distinctDraftWriteTimes: [...new Set((rows ?? []).filter(r => r.state === 'draft').map(r => String(r.updated_at).slice(0, 19)))].slice(0, 10),
    lastMessages: messages.slice(-3).map(m => ({ role: m.role, at: m.timestamp, text: String(m.content ?? '').slice(0, 120) })),
  })
}
