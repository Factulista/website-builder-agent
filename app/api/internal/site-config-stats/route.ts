/**
 * GET /api/internal/site-config-stats?projectId=xxx
 * Diagnostic: byte size of each top-level key in site_config — to see how much
 * JSON every route that does select('site_config') downloads and parses per request.
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
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const t0 = Date.now()
  const { data, error } = await supabase.from('projects').select('site_config').eq('id', projectId).single()
  const fetchMs = Date.now() - t0
  if (error || !data) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const config = (data.site_config ?? {}) as Record<string, unknown>
  const t1 = Date.now()
  const total = JSON.stringify(config).length
  const stringifyMs = Date.now() - t1
  const keys = Object.entries(config)
    .map(([k, v]) => ({ key: k, bytes: JSON.stringify(v ?? null).length }))
    .sort((a, b) => b.bytes - a.bytes)
  return NextResponse.json({ totalBytes: total, fetchMs, stringifyMs, keys })
}
