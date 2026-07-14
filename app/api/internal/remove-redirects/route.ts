/**
 * POST /api/internal/remove-redirects
 * Body: { projectId, from: string[] }   (from = redirect source paths/slugs to delete)
 * Removes matching entries from config.redirects (matched by normalized `from`).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireInternalSecret } from '../../../../lib/api-auth'
export const runtime = 'nodejs'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

const norm = (s: string) => s.trim().replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+|\/+$/g, '')

export async function POST(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr

  const body = await req.json().catch(() => null)
  const projectId = body?.projectId as string | undefined
  const from = (body?.from as string[] | undefined) ?? []
  if (!projectId || !from.length) return NextResponse.json({ error: 'projectId and from[] required' }, { status: 400 })

  const supabase = getSupabase()
  const { data, error } = await supabase.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const config = (data.site_config ?? {}) as Record<string, unknown>
  const redirects = (config.redirects as Array<{ from: string; to: string }>) ?? []
  const removeSet = new Set(from.map(norm))
  const kept = redirects.filter(r => !(r.from && removeSet.has(norm(r.from))))
  const removed = redirects.length - kept.length

  const { error: saveErr } = await supabase.from('projects').update({
    site_config: { ...config, redirects: kept },
    updated_at: new Date().toISOString(),
  }).eq('id', projectId)
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })

  return NextResponse.json({ message: 'redirects removed', removed, remaining: kept.length })
}
