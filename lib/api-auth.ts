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

/**
 * Resolve user AND verify they own the given project (401/404), reading ONLY the
 * given top-level `site_config` keys (PostgREST json-path select, e.g.
 * `sc_context:site_config->context`), reassembled into a partial `site_config`. The full blob is ~7MB (draft + published pages); chat and
 * component only need a few small settings, so this avoids detoasting/shipping the whole
 * thing on every message (Oct 2026 Supabase load plan, phase 2.0).
 * Missing keys come back as null and are omitted from the result.
 */
export async function requireUserAndProjectKeys(req: NextRequest, projectId: string, keys: readonly string[]) {
  if (!projectId) throw new ApiError(400, 'projectId richiesto')
  for (const k of keys) if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new ApiError(500, `bad site_config key ${k}`)
  const { user, supabase } = await requireUser(req)
  const cols = keys.map(k => `sc_${k}:site_config->${k}`).join(', ')
  const { data } = await supabase
    .from('projects')
    .select(`id, user_id, slug, name${cols ? ', ' + cols : ''}`)
    .eq('id', projectId)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .single()
  if (!data) throw new ApiError(404, 'Progetto non trovato')
  const row = data as unknown as Record<string, unknown>
  const site_config: Record<string, unknown> = {}
  for (const k of keys) if (row[`sc_${k}`] != null) site_config[k] = row[`sc_${k}`]
  const project = { id: row.id as string, user_id: row.user_id as string, slug: row.slug as string, name: row.name as string, site_config }
  return { user, supabase, project }
}

/**
 * Same ownership check as requireUserAndProjectKeys, WITHOUT any `site_config` —
 * for routes that only need to verify the caller owns the project and never read
 * its content (e.g. generate-blog-post, which fetches an unrelated Anthropic
 * stream and only needs `user.id`). `site_config` can be several MB on an active
 * project; fetching and discarding it on every request is real, avoidable load
 * on the DB. Use `requireUserAndProjectKeys` instead whenever the route actually
 * reads `project.site_config`/`slug`/etc. afterward.
 */
export async function requireUserAndProjectOwnership(req: NextRequest, projectId: string) {
  if (!projectId) throw new ApiError(400, 'projectId richiesto')
  const { user, supabase } = await requireUser(req)
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .single()
  if (!project) throw new ApiError(404, 'Progetto non trovato')
  return { user, supabase }
}

/**
 * Guard for /api/internal/* maintenance endpoints: requires the
 * x-internal-secret header to match INTERNAL_API_SECRET. Fails closed
 * if the env var is missing. Returns a Response to send, or null if OK.
 */
export function requireInternalSecret(req: NextRequest): Response | null {
  const secret = process.env.INTERNAL_API_SECRET
  if (!secret || req.headers.get('x-internal-secret') !== secret) {
    return new Response(JSON.stringify({ error: 'Non autorizzato' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return null
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
