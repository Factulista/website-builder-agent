/**
 * GET /api/internal/snapshot-bench?projectSlug=factulista&host=www.factulista.com&page=precios&n=10
 * Server-side benchmark (no public traffic, so it can't trip Vercel's DDoS checkpoint):
 * reads the same published page N times through the old path (get_published_page RPC,
 * which makes Postgres decompress the whole site_config) and N times through the
 * snapshot row, reporting wall time, payload size and Postgres execution time
 * (pg_stat_statements delta from the metrics endpoint) for each.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireInternalSecret } from '../../../../lib/api-auth'
export const runtime = 'nodejs'
export const maxDuration = 120

async function dbTimeSeconds(): Promise<number> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!, key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const res = await fetch(`${base}/customer/v1/privileged/metrics`, { headers: { Authorization: 'Basic ' + Buffer.from(`service_role:${key}`).toString('base64') }, cache: 'no-store' })
  const line = (await res.text()).split('\n').find(l => l.startsWith('pg_stat_statements_total_time_seconds'))
  return line ? Number(line.trim().split(/\s+/).pop()) : NaN
}

export async function GET(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr
  const q = req.nextUrl.searchParams
  const projectSlug = q.get('projectSlug') ?? 'factulista', host = q.get('host') ?? 'www.factulista.com'
  const page = q.get('page') ?? 'precios', n = Math.min(Number(q.get('n') ?? 10), 30)
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const run = async (label: string, fn: () => Promise<number>) => {
    const t0 = await dbTimeSeconds(); const w0 = Date.now(); let bytes = 0
    for (let i = 0; i < n; i++) bytes += await fn()
    const wall = Date.now() - w0
    await new Promise(r => setTimeout(r, 1500)) // let pg_stat_statements settle
    const t1 = await dbTimeSeconds()
    return { label, requests: n, wallMsPerRequest: Math.round(wall / n), kbPerRequest: Math.round(bytes / n / 1024), dbMsPerRequest: Number.isFinite(t1 - t0) ? Math.round(((t1 - t0) * 1000) / n) : null }
  }
  const oldPath = await run('vecchia strada (get_published_page)', async () => {
    const { data } = await sb.rpc('get_published_page', { p_slug: projectSlug, p_page: page }).maybeSingle()
    return JSON.stringify(data ?? '').length
  })
  const newPath = await run('pagina pronta (published_snapshots)', async () => {
    const { data } = await sb.from('published_snapshots').select('status, content_type, body').eq('project_slug', projectSlug).eq('host', host).eq('path', page).maybeSingle()
    return JSON.stringify(data ?? '').length
  })
  return NextResponse.json({ page, oldPath, newPath })
}
