import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isAdmin } from '../../../../../lib/admin'
import { getAgentConfig, getAgentConfigs, updateAgentConfig } from '../../../../../lib/agents/db-config'
import { AGENTS_MANIFEST } from '../../../../../lib/agents/manifest'
import { invalidateAgentsCache } from '../../../../../lib/agents/agents-cache'

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
    let db = await getAgentConfig(name)
    // If not found, trigger seeding (first visit) then retry
    if (!db) {
      await getAgentConfigs()
      db = await getAgentConfig(name)
    }
    if (!db) return Response.json({ error: 'Agent not found' }, { status: 404 })

    const meta = AGENTS_MANIFEST.find(a => a.name === name)
    return Response.json({
      ...db,
      displayName: db.display_name ?? meta?.displayName ?? db.name,
      description: db.description ?? meta?.description ?? '',
      category: db.category ?? meta?.category ?? 'utility',
      inputs: db.inputs ?? meta?.inputs ?? [],
      outputs: db.outputs ?? meta?.outputs ?? [],
      filePath: db.file_path ?? meta?.filePath ?? '',
      rules: db.rules ?? meta?.rules ?? [],
    })
  } catch (err) {
    const msg = String(err)
    const isMissingTable = msg.includes('agent_configs') && (msg.includes('does not exist') || msg.includes('42P01'))
    if (isMissingTable) {
      return Response.json({
        error: 'Tabelle DB non trovate. Esegui la migration SQL in Supabase prima di usare il Back Office.',
      }, { status: 503 })
    }
    return Response.json({ error: msg }, { status: 500 })
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
      display_name?: string
      description?: string
      category?: string
      file_path?: string
      rules?: string[]
      inputs?: string[]
      outputs?: string[]
    }

    const patch: Parameters<typeof updateAgentConfig>[1] = {}
    if (body.model !== undefined) patch.model = body.model
    if (body.max_tokens !== undefined) patch.max_tokens = body.max_tokens
    if (body.enabled !== undefined) patch.enabled = body.enabled
    if (body.system_prompt !== undefined) patch.system_prompt = body.system_prompt
    if (body.display_name !== undefined) patch.display_name = body.display_name
    if (body.description !== undefined) patch.description = body.description
    if (body.category !== undefined) patch.category = body.category
    if (body.file_path !== undefined) patch.file_path = body.file_path
    if (body.rules !== undefined) patch.rules = body.rules
    if (body.inputs !== undefined) patch.inputs = body.inputs
    if (body.outputs !== undefined) patch.outputs = body.outputs

    const updated = await updateAgentConfig(name, patch)
    invalidateAgentsCache()  // bust the list cache so changes appear immediately
    const meta = AGENTS_MANIFEST.find(a => a.name === name)
    return Response.json({
      ...updated,
      displayName: updated.display_name ?? meta?.displayName ?? updated.name,
      description: updated.description ?? meta?.description ?? '',
      category: updated.category ?? meta?.category ?? 'utility',
      inputs: updated.inputs ?? meta?.inputs ?? [],
      outputs: updated.outputs ?? meta?.outputs ?? [],
      filePath: updated.file_path ?? meta?.filePath ?? '',
      rules: updated.rules ?? meta?.rules ?? [],
    })
  } catch (err) {
    const msg = String(err)
    const isMissingTable = msg.includes('agent_configs') && (msg.includes('does not exist') || msg.includes('42P01'))
    if (isMissingTable) {
      return Response.json({
        error: 'Tabelle DB non trovate. Esegui la migration SQL in Supabase prima di usare il Back Office.',
      }, { status: 503 })
    }
    return Response.json({ error: msg }, { status: 500 })
  }
}
