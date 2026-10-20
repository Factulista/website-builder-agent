import type { SupabaseClient } from '@supabase/supabase-js'
import { coalesce } from './request-coalesce'

/**
 * Blog / Ayuda routes build the header menu from the lite site config, whose `pages`
 * are the DRAFT pages. On the live site (request carries x-original-host) a page that
 * exists only as a draft must not appear in the menu, so we keep only the slugs listed
 * in the published routing manifest (published_snapshots '__manifest', written at
 * publish time). Builder/preview requests (no x-original-host) are left unchanged.
 * If the manifest can't be read, the list is returned as-is (previous behaviour).
 */
export async function filterMegaPagesForLive<T extends { slug: string }>(
  supabase: SupabaseClient,
  projectSlug: string,
  req: Request,
  megaPages: T[],
): Promise<T[]> {
  const host = req.headers.get('x-original-host')
  if (!host || !megaPages.length) return megaPages
  const published = await coalesce(`manifest-slugs:${projectSlug}:${host}`, 30_000, async () => {
    const { data, error } = await supabase.from('published_snapshots')
      .select('body').eq('project_slug', projectSlug).eq('host', host).eq('path', '__manifest').maybeSingle()
    if (error || !data) return null
    try { return (JSON.parse((data as { body: string }).body) as { pages?: string[] }).pages ?? null } catch { return null }
  })
  if (!published) return megaPages
  const set = new Set(published)
  return megaPages.filter(p => set.has(p.slug))
}
