/**
 * POST /api/internal/patch-selftest?projectId=xxx
 * Live self-test of update_site_config_paths (step 3.3): fires concurrent single-field
 * patches on a scratch key `_patch_selftest`, verifies none was lost (no lost update) and
 * that nested objects are created, then deletes the scratch key. Touches nothing else.
 * Refuses to run without the RPC: the client-side fallback would mean N concurrent
 * full-blob rewrites of a production site_config.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireInternalSecret } from '../../../../lib/api-auth'
import { patchSiteConfig } from '../../../../lib/site-config-patch'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr
  const projectId = req.nextUrl.searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const stamp = Date.now()
  const readKey = async () => {
    const { data } = await sb.from('projects').select('t:site_config->_patch_selftest').eq('id', projectId).single()
    return (data as { t?: unknown } | null)?.t ?? null
  }
  const rpcDirect = await sb.rpc('update_site_config_paths', { p_id: projectId, p_sets: [] })
  const rpcAvailable = !rpcDirect.error
  if (!rpcAvailable) return NextResponse.json({ rpcAvailable, pass: false, error: rpcDirect.error?.message })

  // 10 concurrent patches on sibling keys + one deep nested path
  const N = 10
  const results = await Promise.all([
    ...Array.from({ length: N }, (_, i) => patchSiteConfig(sb, projectId, [{ path: ['_patch_selftest', `k${i}`], value: stamp + i }])),
    patchSiteConfig(sb, projectId, [{ path: ['_patch_selftest', 'deep', 'a', 'b'], value: 'ok' }]),
  ])
  const after = (await readKey()) as Record<string, unknown> | null
  const missing = Array.from({ length: N }, (_, i) => `k${i}`).filter((k, i) => after?.[k] !== stamp + i)
  const deepOk = (after?.deep as { a?: { b?: string } } | undefined)?.a?.b === 'ok'

  await patchSiteConfig(sb, projectId, [{ path: ['_patch_selftest'], delete: true }])
  const cleaned = (await readKey()) === null

  return NextResponse.json({
    rpcAvailable,
    errors: results.map(r => r.error).filter(Boolean),
    concurrentWrites: N,
    lostUpdates: missing,
    nestedCreated: deepOk,
    cleanedUp: cleaned,
    pass: rpcAvailable && missing.length === 0 && deepOk && cleaned,
  })
}
