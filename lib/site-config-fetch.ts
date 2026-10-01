import type { SupabaseClient } from '@supabase/supabase-js'
import { coalesce } from './request-coalesce'

/**
 * Host-independent "site shell" rows: the exact LiteProject that fetchSiteConfigLite
 * returns (via the get_site_config_lite RPC) for the two variants the public blog /
 * Ayuda / sitemap / robots / favicon routes use — htmlSlug 'home' and null — so those
 * routes read a ~200KB row instead of making Postgres decompress the whole site_config.
 * (Blog posts / Ayuda articles themselves are still read live from their own tables.)
 */
export const LITE_HOST = '_lite'
export const liteSnapshotPath = (htmlSlug: string | null) => `__lite:${htmlSlug ?? ''}`
export const LITE_SNAPSHOT_SLUGS: Array<string | null> = ['home', null]

/**
 * Loads a project's site_config WITHOUT the multi-MB parts public serving never needs.
 *
 * Why: site_config holds every page twice (draft `pages` + `published_pages`, each with
 * its html AND a duplicate `blocks` copy) plus builder-only data — ~13MB for factulista.
 * Routes that did select('site_config') downloaded and JSON.parsed all of it on every
 * request (favicon, robots, sitemap, every blog post / Ayuda page), which is what burned
 * the Vercel Fluid Active CPU quota. The get_site_config_lite RPC trims it inside Postgres:
 * drops published_pages/messages/media/versions, strips `blocks` from pages, and keeps a
 * page's `html` only when asked for (htmlSlug = that page's slug, '*' = all, null = none).
 *
 * Returned `site_config` keeps the exact shape callers already read (config.pages[].slug,
 * .name, .megaMenu, .inMenu …, config.shared_nav_html, …), so call sites don't change.
 *
 * Falls back to the full select if the RPC isn't deployed yet (migration not run), so a
 * deploy of this code is always safe — it just doesn't save anything until the SQL runs.
 */

export type LiteProject = { id: string; name: string | null; custom_domain: string | null; site_config: Record<string, unknown> }

export function fetchSiteConfigLite(
  supabase: SupabaseClient,
  projectSlug: string,
  htmlSlug: string | null,
): Promise<LiteProject | null> {
  // Concurrent identical reads share one DB round-trip; result reused for 30s
  // (see lib/request-coalesce.ts). Not-found (null) is never cached.
  return coalesce(`lite:${projectSlug}:${htmlSlug ?? ''}`, 30_000, () => fetchUncached(supabase, projectSlug, htmlSlug))
}

async function fetchUncached(
  supabase: SupabaseClient,
  projectSlug: string,
  htmlSlug: string | null,
): Promise<LiteProject | null> {
  // Pre-rendered site shell (written by lib/published-snapshots.ts) when available.
  if (process.env.SNAPSHOTS_DISABLED !== '1' && LITE_SNAPSHOT_SLUGS.includes(htmlSlug)) {
    const { data, error } = await supabase.from('published_snapshots')
      .select('body')
      .eq('project_slug', projectSlug).eq('host', LITE_HOST).eq('path', liteSnapshotPath(htmlSlug))
      .maybeSingle()
    if (!error && data?.body) {
      try { return JSON.parse(data.body as string) as LiteProject } catch { /* fall through to the RPC */ }
    }
  }
  const rpc = await supabase.rpc('get_site_config_lite', { p_slug: projectSlug, p_html_slug: htmlSlug }).maybeSingle()
  if (!rpc.error && rpc.data) {
    const d = rpc.data as { id: string; name: string | null; custom_domain: string | null; config: Record<string, unknown> }
    return { id: d.id, name: d.name, custom_domain: d.custom_domain, site_config: d.config ?? {} }
  }
  if (!rpc.error && !rpc.data) return null // RPC exists, project not found

  // Fallback: RPC missing — old full select.
  const { data } = await supabase
    .from('projects')
    .select('id, name, custom_domain, site_config')
    .eq('slug', projectSlug)
    .is('deleted_at', null)
    .single()
  if (!data) return null
  return {
    id: data.id as string,
    name: (data.name as string | null) ?? null,
    custom_domain: (data.custom_domain as string | null) ?? null,
    site_config: (data.site_config ?? {}) as Record<string, unknown>,
  }
}
