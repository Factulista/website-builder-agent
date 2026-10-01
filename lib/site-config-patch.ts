import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Update individual (optionally nested) site_config fields without a client-side
 * read-modify-write of the whole blob.
 *
 * Why: settings saves (favicon, redirects, OG image, banners, forms, the chat's
 * sessionMemory/context/designSystem…) used to SELECT the entire site_config (~7MB),
 * change one key, and UPDATE all of it back — ~14MB of traffic per click, and a
 * lost-update race: whoever saved second overwrote everything the other person had
 * saved in between (the root of the recurring "it reverted" collisions).
 *
 * The update_site_config_paths RPC applies the sets inside Postgres under a row lock
 * (jsonb_set per path, creating missing intermediate objects), so concurrent saves
 * compose instead of overwriting each other, and only the changed values travel.
 *
 * Falls back to the old full read-modify-write if the RPC isn't deployed yet, so this
 * is always safe to ship before the SQL migration runs.
 *
 * Usable from the browser (user session; RLS applies) and server (service role).
 */
export type SiteConfigSet = { path: string[]; value?: unknown; delete?: boolean }

export async function patchSiteConfig(
  supabase: SupabaseClient,
  projectId: string,
  sets: SiteConfigSet[],
): Promise<{ error: string | null }> {
  if (sets.length === 0) return { error: null }
  const { error } = await supabase.rpc('update_site_config_paths', { p_id: projectId, p_sets: sets })
  if (!error) return { error: null }

  console.warn('[patchSiteConfig] RPC unavailable/failed, falling back to full write:', error.message)
  const { data, error: readErr } = await supabase.from('projects').select('site_config').eq('id', projectId).single()
  if (readErr || !data?.site_config) return { error: readErr?.message ?? 'site_config read failed' }
  const cfg = structuredClone(data.site_config) as Record<string, unknown>
  for (const s of sets) {
    if (s.delete) deletePath(cfg, s.path)
    else setPath(cfg, s.path, s.value)
  }
  const { error: writeErr } = await supabase.from('projects')
    .update({ site_config: cfg, updated_at: new Date().toISOString() })
    .eq('id', projectId)
  return { error: writeErr?.message ?? null }
}

function setPath(obj: Record<string, unknown>, path: string[], value: unknown) {
  let cur: Record<string, unknown> = obj
  for (let i = 0; i < path.length - 1; i++) {
    const next = cur[path[i]]
    if (!next || typeof next !== 'object' || Array.isArray(next)) cur[path[i]] = {}
    cur = cur[path[i]] as Record<string, unknown>
  }
  cur[path[path.length - 1]] = value
}

function deletePath(obj: Record<string, unknown>, path: string[]) {
  let cur: unknown = obj
  for (let i = 0; i < path.length - 1; i++) {
    if (!cur || typeof cur !== 'object') return
    cur = (cur as Record<string, unknown>)[path[i]]
  }
  if (cur && typeof cur === 'object') delete (cur as Record<string, unknown>)[path[path.length - 1]]
}
