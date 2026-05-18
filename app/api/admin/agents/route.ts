import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isAdmin } from '../../../../lib/admin'
import { getAgentConfigs, syncAgentMetadata } from '../../../../lib/agents/db-config'
import { AGENTS_MANIFEST } from '../../../../lib/agents/manifest'

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

export async function GET(req: NextRequest) {
  const auth = await verifyAdmin(req)
  if (!auth.ok) return Response.json({ error: auth.error }, { status: 401 })

  try {
    // Sync metadati in background (non-blocking)
    syncAgentMetadata().catch(e => console.warn('[agents] syncAgentMetadata failed:', e))

    const dbConfigs = await getAgentConfigs()

    const merged = dbConfigs.map(db => {
      // Fallback al manifest solo per campi non ancora nel DB
      const meta = AGENTS_MANIFEST.find(a => a.name === db.name)
      return {
        ...db,
        displayName: db.display_name ?? meta?.displayName ?? db.name,
        description: db.description ?? meta?.description ?? '',
        category: db.category ?? meta?.category ?? 'utility',
        inputs: db.inputs ?? meta?.inputs ?? [],
        outputs: db.outputs ?? meta?.outputs ?? [],
        filePath: db.file_path ?? meta?.filePath ?? '',
        rules: db.rules ?? meta?.rules ?? [],
      }
    })

    return Response.json(merged)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
