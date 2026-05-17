import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isAdmin } from '../../../../lib/admin'
import { getAgentConfigs } from '../../../../lib/agents/db-config'
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
    const dbConfigs = await getAgentConfigs()

    const merged = dbConfigs.map(db => {
      const meta = AGENTS_MANIFEST.find(a => a.name === db.name)
      return {
        ...db,
        displayName: meta?.displayName ?? db.name,
        description: meta?.description ?? '',
        category: meta?.category ?? 'utility',
        inputs: meta?.inputs ?? [],
        outputs: meta?.outputs ?? [],
        filePath: meta?.filePath ?? '',
      }
    })

    return Response.json(merged)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
