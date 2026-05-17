import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isAdmin } from '../../../../../lib/admin'
import { getRun } from '../../../../../lib/agents/run-logger'

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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAdmin(req)
  if (!auth.ok) return Response.json({ error: auth.error }, { status: 401 })

  const { id } = await params
  try {
    const run = await getRun(id)
    if (!run) return Response.json({ error: 'Run not found' }, { status: 404 })
    return Response.json(run)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
