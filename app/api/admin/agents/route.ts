import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isAdmin } from '../../../../lib/admin'
import { getAgentConfigs, syncAgentMetadata, type DbAgentConfig } from '../../../../lib/agents/db-config'
import { AGENTS_MANIFEST } from '../../../../lib/agents/manifest'
import { getAgentsCache, setAgentsCache, shouldRunSync, resetSyncFlag } from '../../../../lib/agents/agents-cache'

function triggerSyncOnce() {
  if (!shouldRunSync()) return
  syncAgentMetadata().catch(e => {
    resetSyncFlag() // allow retry on failure
    console.warn('[agents] syncAgentMetadata failed:', e?.message ?? e)
  })
}

async function verifyAdmin(req: NextRequest): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return { ok: false, error: 'No token' }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return { ok: false, error: 'Invalid token' }
  if (!isAdmin(user.email)) return { ok: false, error: 'Not admin' }
  return { ok: true }
}

function manifestAsConfigs() {
  return AGENTS_MANIFEST.map(a => ({
    name: a.name,
    model: a.model,
    max_tokens: a.maxTokens,
    enabled: a.enabled,
    system_prompt: a.systemPromptPreview,
    updated_at: new Date().toISOString(),
    display_name: a.displayName,
    description: a.description,
    category: a.category as string,
    file_path: a.filePath,
    rules: a.rules ?? [],
    inputs: a.inputs,
    outputs: a.outputs,
  }))
}

function mergeWithManifestFields<T extends { name: string; display_name?: string | null; description?: string | null; category?: string | null; file_path?: string | null; rules?: string[] | null; inputs?: string[] | null; outputs?: string[] | null }>(rows: T[]) {
  return rows.map(db => {
    const meta = AGENTS_MANIFEST.find(a => a.name === db.name)
    return {
      ...db,
      displayName: db.display_name ?? meta?.displayName ?? db.name,
      description: db.description ?? meta?.description ?? '',
      category: (db.category ?? meta?.category ?? 'utility') as string,
      inputs: db.inputs ?? meta?.inputs ?? [],
      outputs: db.outputs ?? meta?.outputs ?? [],
      filePath: db.file_path ?? meta?.filePath ?? '',
      rules: db.rules ?? meta?.rules ?? [],
    }
  })
}

export async function GET(req: NextRequest) {
  const auth = await verifyAdmin(req)
  if (!auth.ok) return Response.json({ error: auth.error }, { status: 401 })

  // Top-level try/catch: in caso di qualsiasi crash, restituisci sempre il manifest
  try {
    // Run sync only ONCE per server lifetime (was: every request → 14 serial DB updates)
    triggerSyncOnce()

    // Cache hit: skip Supabase entirely (60s TTL)
    const cached = getAgentsCache()
    if (cached) {
      return Response.json(mergeWithManifestFields(cached))
    }

    let dbConfigs: DbAgentConfig[]
    try {
      dbConfigs = await getAgentConfigs()
    } catch (e) {
      console.warn('[agents] getAgentConfigs threw, using manifest:', e instanceof Error ? e.message : e)
      dbConfigs = manifestAsConfigs() as DbAgentConfig[]
    }

    if (!Array.isArray(dbConfigs) || dbConfigs.length === 0) {
      console.warn('[agents] dbConfigs empty, using manifest')
      dbConfigs = manifestAsConfigs() as DbAgentConfig[]
    }

    setAgentsCache(dbConfigs)
    return Response.json(mergeWithManifestFields(dbConfigs))
  } catch (err) {
    console.error('[agents] uncaught error, falling back to manifest:', err instanceof Error ? err.message : err)
    // Ultimo baluardo: anche se tutto crasha, restituiamo il manifest puro
    return Response.json(mergeWithManifestFields(manifestAsConfigs()))
  }
}
