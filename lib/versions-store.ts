import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Version history storage (migration 20261007_versions_dedup.sql).
 *
 * A version stores page metadata + `html_ref` (sha256 of the html); each distinct
 * html is stored once in page_html_blobs. The client sends html only for hashes the
 * DB doesn't have yet (`known`), so a version after a one-page edit costs ~one page
 * instead of a full copy of the site. Before the migration runs, every call reports
 * "unsupported" (null) and the caller uses the legacy full-copy insert.
 */

function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message ?? ''))
}

/** sha256 hex of the UTF-8 bytes — same as the SQL _html_hash(). */
export async function htmlHash(html: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(html))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Hashes of the html blobs already stored for a project (empty set if unknown). */
export async function loadKnownHtmlHashes(sb: SupabaseClient, projectId: string): Promise<Set<string>> {
  const { data, error } = await sb.rpc('version_blob_hashes', { p_id: projectId })
  if (error || !Array.isArray(data)) return new Set()
  return new Set((data as unknown[]).map(h => (typeof h === 'string' ? h : String((h as Record<string, unknown>)?.version_blob_hashes ?? ''))).filter(Boolean))
}

/**
 * Create a version (server prunes to `keep` and drops unreferenced blobs).
 * Returns null when the dedup functions aren't installed (caller falls back).
 * `known` is updated in place with the hashes now stored.
 */
export async function createVersionDedup(
  sb: SupabaseClient,
  projectId: string,
  summary: string,
  pages: Array<{ slug: string; html?: string }>,
  known: Set<string>,
  keep = 10,
): Promise<{ id: string; created_at: string } | null> {
  const hashed = await Promise.all(pages.map(async p => {
    const { blocks: _blocks, ...rest } = p as { slug: string; html?: string; blocks?: unknown }
    return { page: rest, hash: typeof rest.html === 'string' ? await htmlHash(rest.html) : null }
  }))
  const payload = (sendAll: boolean) => hashed.map(({ page, hash }) => {
    if (!hash || sendAll || !known.has(hash)) return page
    const { html: _html, ...meta } = page
    return { ...meta, html_ref: hash }
  })
  let res = await sb.rpc('version_create', { p_id: projectId, p_summary: summary, p_pages: payload(false), p_keep: keep })
  if (res.error && /version_missing_blobs/.test(res.error.message)) {
    // Our cache of stored hashes was stale (e.g. GC'd meanwhile): send everything.
    known.clear()
    res = await sb.rpc('version_create', { p_id: projectId, p_summary: summary, p_pages: payload(true), p_keep: keep })
  }
  if (res.error) {
    if (isMissingFunction(res.error)) return null
    throw new Error(`createVersion failed: ${res.error.message}`)
  }
  for (const { hash } of hashed) if (hash) known.add(hash)
  return res.data as { id: string; created_at: string }
}

/** Full pages of a version (legacy rows included), or null if not found. */
export async function loadVersionPages<T = Record<string, unknown>>(sb: SupabaseClient, versionId: string): Promise<T[] | null> {
  const viaRpc = await sb.rpc('version_get', { p_version_id: versionId })
  if (!viaRpc.error) return Array.isArray(viaRpc.data) ? (viaRpc.data as T[]) : null
  if (!isMissingFunction(viaRpc.error)) throw new Error(`loadVersionPages failed: ${viaRpc.error.message}`)
  const { data, error } = await sb.from('project_versions').select('pages').eq('id', versionId).single()
  if (error || !data) return null
  return (data.pages as T[]) ?? null
}
