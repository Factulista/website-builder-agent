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
  // ?detail=pages → per-page fingerprint of pages + published_pages (html sha256, field
  // names, blocks presence) so a data cleanup can be proven to leave html untouched.
  if (req.nextUrl.searchParams.get('detail') === 'pages') {
    const { createHash } = await import('crypto')
    const fp = (arr: unknown) => ((arr as Array<Record<string, unknown>>) ?? []).map(p => ({
      slug: p.slug,
      htmlSha: createHash('sha256').update(String(p.html ?? '')).digest('hex').slice(0, 16),
      htmlLen: String(p.html ?? '').length,
      hasBlocks: Array.isArray(p.blocks) && (p.blocks as unknown[]).length > 0,
      fields: Object.keys(p).filter(k => k !== 'html' && k !== 'blocks').sort(),
      meta: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'html' && k !== 'blocks')),
    }))
    return NextResponse.json({ pages: fp(config.pages), published_pages: fp(config.published_pages) })
  }
  const keys = Object.entries(config)
    .map(([k, v]) => ({ key: k, bytes: JSON.stringify(v ?? null).length }))
    .sort((a, b) => b.bytes - a.bytes)
  return NextResponse.json({ totalBytes: total, fetchMs, stringifyMs, keys })
}
