import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isAdmin } from '../../../../../../lib/admin'
import { getPromptVersions, updateAgentConfig } from '../../../../../../lib/agents/db-config'

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
    const versions = await getPromptVersions(name)
    return Response.json(versions)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<Params> }) {
  const auth = await verifyAdmin(req)
  if (!auth.ok) return Response.json({ error: auth.error }, { status: 401 })

  const { name } = await params

  try {
    const { versionId } = await req.json() as { versionId: string }

    // Fetch the specific version
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { data: version, error } = await supabase
      .from('agent_prompt_versions')
      .select('*')
      .eq('id', versionId)
      .eq('agent_name', name)
      .single()

    if (error || !version) {
      return Response.json({ error: 'Version not found' }, { status: 404 })
    }

    // Format restore label
    const date = new Date(version.created_at as string)
    const dd = String(date.getDate()).padStart(2, '0')
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const yy = String(date.getFullYear()).slice(2)
    const label = `Restored from v${yy}-${mm}-${dd}`

    // Update agent config with restored values — this will also create a new version entry
    const updated = await updateAgentConfig(name, {
      system_prompt: version.system_prompt as string,
      model: version.model as string,
      max_tokens: version.max_tokens as number,
    })

    // Update the label on the newly-created version entry
    const versions = await getPromptVersions(name)
    const newest = versions[0]
    if (newest) {
      await supabase
        .from('agent_prompt_versions')
        .update({ label })
        .eq('id', newest.id)
    }

    return Response.json(updated)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
