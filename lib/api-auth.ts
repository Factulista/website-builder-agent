/**
 * Shared auth + ownership helpers for API routes.
 * Centralizes the bearer-token check and project ownership verification
 * so individual endpoints can't accidentally skip them.
 */
import { NextRequest } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export function getServiceSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/** Resolve the authenticated user from a Bearer token, or throw 401. */
export async function requireUser(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) {
    throw new ApiError(401, 'Non autorizzato')
  }
  const supabase = getServiceSupabase()
  const { data: { user }, error } = await supabase.auth.getUser(auth.slice(7))
  if (error || !user) throw new ApiError(401, 'Token non valido')
  return { user, supabase }
}

/** Resolve user AND verify they own the given project. Throws 401/404. */
export async function requireUserAndProject(req: NextRequest, projectId: string) {
  if (!projectId) throw new ApiError(400, 'projectId richiesto')
  const { user, supabase } = await requireUser(req)
  const { data: project } = await supabase
    .from('projects')
    .select('id, user_id, slug, name, site_config')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .single()
  if (!project) throw new ApiError(404, 'Progetto non trovato')
  return { user, supabase, project }
}

/** Wrap a handler so ApiError becomes a proper JSON response. */
export function jsonError(err: unknown) {
  if (err instanceof ApiError) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: err.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  console.error('[api] unhandled error:', err)
  return new Response(JSON.stringify({ error: 'Errore interno' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  })
}
