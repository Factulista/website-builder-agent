import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isAdmin } from '../../../../../lib/admin'
import { getAgentConfig, updateAgentConfig } from '../../../../../lib/agents/db-config'
import { AGENTS_MANIFEST } from '../../../../../lib/agents/manifest'

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

type Params = { name: string }

export async function GET(req: NextRequest, { params }: { params: Promise<Params> }) {
  const auth = await verifyAdmin(req)
  if (!auth.ok) return Response.json({ error: auth.error }, { status: 401 })

  const { name } = await params

  try {
    const db = await getAgentConfig(name)
    if (!db) return Response.json({ error: 'Agent not found' }, { status: 404 })

    const meta = AGENTS_MANIFEST.find(a => a.name === name)
    return Response.json({
      ...db,
      displayName: meta?.displayName ?? db.name,
      description: meta?.description ?? '',
      category: meta?.category ?? 'utility',
      inputs: meta?.inputs ?? [],
      outputs: meta?.outputs ?? [],
      filePath: meta?.filePath ?? '',
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<Params> }) {
  const auth = await verifyAdmin(req)
  if (!auth.ok) return Response.json({ error: auth.error }, { status: 401 })

  const { name } = await params

  try {
    const body = await req.json() as {
      model?: string
      max_tokens?: number
      enabled?: boolean
      system_prompt?: string
    }

    const patch: Parameters<typeof updateAgentConfig>[1] = {}
    if (body.model !== undefined) patch.model = body.model
    if (body.max_tokens !== undefined) patch.max_tokens = body.max_tokens
    if (body.enabled !== undefined) patch.enabled = body.enabled
    if (body.system_prompt !== undefined) patch.system_prompt = body.system_prompt

    const updated = await updateAgentConfig(name, patch)
    const meta = AGENTS_MANIFEST.find(a => a.name === name)
    return Response.json({
      ...updated,
      displayName: meta?.displayName ?? updated.name,
      description: meta?.description ?? '',
      category: meta?.category ?? 'utility',
      inputs: meta?.inputs ?? [],
      outputs: meta?.outputs ?? [],
      filePath: meta?.filePath ?? '',
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
