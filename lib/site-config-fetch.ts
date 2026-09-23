import type { SupabaseClient } from '@supabase/supabase-js'

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

export async function fetchSiteConfigLite(
  supabase: SupabaseClient,
  projectSlug: string,
  htmlSlug: string | null,
): Promise<LiteProject | null> {
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
