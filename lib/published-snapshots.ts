import type { SupabaseClient } from '@supabase/supabase-js'
import { renderPublishedPageHtml, resolvePublishedRedirect, SNAPSHOT_MANIFEST_PATH, type PublishedManifest } from './preview'
import { LITE_HOST, liteSnapshotPath, LITE_SNAPSHOT_SLUGS } from './site-config-fetch'

/**
 * Pre-rendered published pages ("static publishing", point 1 of the Oct 2026
 * Supabase load plan — free variant: snapshots live in a Supabase table instead of
 * Vercel Blob, whose Hobby quota is too small for our read volume).
 *
 * Every public page request used to make Postgres decompress the whole site_config
 * (~7MB) and Vercel re-run prepareHtml. Now "Pubblica" (and every change that affects
 * the published output) renders each page ONCE with the very same function the live
 * path uses (renderPublishedPageHtml) and stores the final html, one ~100KB row per
 * page + a small routing manifest (page list, redirects) so 404s/redirects are cheap
 * too. servePublished reads the row; it falls back to the live render whenever a row
 * is missing, so a failed/partial regeneration degrades to today's behaviour.
 */

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'factulista.com'


/** Hosts a project is publicly served on (base href / canonical depend on the host). */
export function publicHostsFor(project: { slug: string; custom_domain?: string | null; custom_domain_status?: string | null }): string[] {
  const hosts: string[] = []
  const rootProject = process.env.ROOT_DOMAIN_PROJECT ?? ''
  if (rootProject && project.slug === rootProject) hosts.push(`www.${ROOT_DOMAIN}`)
  // The bare root domain (factulista.com) always 301s to www in middleware, so it never
  // reaches servePublished — rendering snapshots for it would be wasted work/storage.
  if (project.custom_domain && project.custom_domain_status === 'verified' && project.custom_domain !== ROOT_DOMAIN) {
    hosts.push(project.custom_domain)
  }
  return [...new Set(hosts)]
}

export type RegenerateResult = {
  ok: boolean
  hosts: string[]
  pages: number
  skippedRedirected: number
  removedStale: number
  durationMs: number
  error?: string
}

export async function regeneratePublishedSnapshots(supabase: SupabaseClient, projectId: string): Promise<RegenerateResult> {
  const t0 = Date.now()
  const fail = (error: string, hosts: string[] = []): RegenerateResult =>
    ({ ok: false, hosts, pages: 0, skippedRedirected: 0, removedStale: 0, durationMs: Date.now() - t0, error })

  const { data: project, error: pErr } = await supabase
    .from('projects')
    .select('slug, custom_domain, custom_domain_status')
    .eq('id', projectId)
    .single()
  if (pErr || !project) return fail(`project not found: ${pErr?.message ?? ''}`)
  const hosts = publicHostsFor(project as { slug: string; custom_domain: string | null; custom_domain_status: string | null })
  if (hosts.length === 0) return { ok: true, hosts, pages: 0, skippedRedirected: 0, removedStale: 0, durationMs: Date.now() - t0 }

  // One full read of the published config per regeneration (not per request).
  const rpc = await supabase.rpc('get_published_site', { p_slug: project.slug }).maybeSingle()
  if (rpc.error || !rpc.data) return fail(`get_published_site failed: ${rpc.error?.message ?? 'no data'}`, hosts)
  const config = (rpc.data as { config: Parameters<typeof renderPublishedPageHtml>[0] }).config
  const projectName = (rpc.data as { name: string | null }).name ?? ''
  const slugs = (config.published_pages ?? []).map(p => p.slug)
  const redirects = (config.redirects ?? []) as Array<{ from: string; to: string }>

  let pages = 0, skippedRedirected = 0, removedStale = 0
  const now = new Date().toISOString()
  for (const host of hosts) {
    const rows: Array<Record<string, unknown>> = []
    for (const slug of slugs) {
      // A path shadowed by a redirect must keep redirecting → no snapshot for it.
      if (resolvePublishedRedirect(slugs, redirects, slug, host)) { skippedRedirected++; continue }
      const html = renderPublishedPageHtml(config, projectName, slug, host)
      if (html === null) continue
      rows.push({ project_slug: project.slug, host, path: slug, project_id: projectId, status: 200, content_type: 'text/html; charset=utf-8', body: html, rendered_at: now })
    }
    const manifest: PublishedManifest = { projectName, pages: slugs, redirects }
    rows.push({ project_slug: project.slug, host, path: SNAPSHOT_MANIFEST_PATH, project_id: projectId, status: 200, content_type: 'application/json', body: JSON.stringify(manifest), rendered_at: now })

    // Upsert in small chunks (~100KB/page) so no single request is huge.
    for (let i = 0; i < rows.length; i += 8) {
      const { error } = await supabase.from('published_snapshots')
        .upsert(rows.slice(i, i + 8), { onConflict: 'project_slug,host,path' })
      if (error) return fail(`upsert failed: ${error.message}`, hosts)
    }
    pages += rows.length - 1

    // Drop rows for pages no longer published / now redirected (after the upsert, so
    // there is never a window where a live page has neither snapshot nor manifest).
    const keep = rows.map(r => `"${String(r.path).replace(/"/g, '\\"')}"`).join(',')
    const { data: removed, error: delErr } = await supabase.from('published_snapshots')
      .delete()
      .eq('project_slug', project.slug).eq('host', host)
      .not('path', 'in', `(${keep})`)
      .select('path')
    if (delErr) return fail(`stale cleanup failed: ${delErr.message}`, hosts)
    removedStale += removed?.length ?? 0
  }

  // Site shell rows for the blog / Ayuda / SEO-file routes (see LITE_HOST).
  for (const htmlSlug of LITE_SNAPSHOT_SLUGS) {
    const lite = await supabase.rpc('get_site_config_lite', { p_slug: project.slug, p_html_slug: htmlSlug }).maybeSingle()
    if (lite.error || !lite.data) return fail(`get_site_config_lite failed: ${lite.error?.message ?? 'no data'}`, hosts)
    const d = lite.data as { id: string; name: string | null; custom_domain: string | null; config: Record<string, unknown> }
    const body = JSON.stringify({ id: d.id, name: d.name, custom_domain: d.custom_domain, site_config: d.config ?? {} })
    const { error } = await supabase.from('published_snapshots').upsert(
      { project_slug: project.slug, host: LITE_HOST, path: liteSnapshotPath(htmlSlug), project_id: projectId, status: 200, content_type: 'application/json', body, rendered_at: now },
      { onConflict: 'project_slug,host,path' },
    )
    if (error) return fail(`shell upsert failed: ${error.message}`, hosts)
  }

  // Drop rows for hosts the project is no longer served on (custom domain removed,
  // or the bare root domain which is never served directly). The shell rows stay.
  const hostList = [...hosts, LITE_HOST].map(h => `"${h.replace(/"/g, '\\"')}"`).join(',')
  const { data: orphaned, error: orphanErr } = await supabase.from('published_snapshots')
    .delete()
    .eq('project_slug', project.slug)
    .not('host', 'in', `(${hostList})`)
    .select('path')
  if (orphanErr) return fail(`orphan-host cleanup failed: ${orphanErr.message}`, hosts)
  removedStale += orphaned?.length ?? 0

  return { ok: true, hosts, pages, skippedRedirected, removedStale, durationMs: Date.now() - t0 }
}

/** Service-role regeneration that never throws (for fire-after-write call sites). */
export async function regenerateAfterChange(projectId: string): Promise<RegenerateResult> {
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    return await regeneratePublishedSnapshots(sb, projectId)
  } catch (e) {
    return { ok: false, hosts: [], pages: 0, skippedRedirected: 0, removedStale: 0, durationMs: 0, error: String(e) }
  }
}

/**
 * Wrap a route handler that changes a project's published output (internal repair
 * tools): after a 2xx response, re-render that project's snapshots so the live site
 * reflects the change. projectId is read from the JSON body or the query string.
 * The regeneration outcome is reported in the `x-snapshots` response header.
 */
export function withSnapshotRegen<R extends Request>(handler: (req: R) => Promise<Response>) {
  return async (req: R): Promise<Response> => {
    const bodyProjectId = await req.clone().json().then((b: { projectId?: string } | null) => b?.projectId).catch(() => undefined)
    const res = await handler(req)
    const projectId = bodyProjectId ?? new URL(req.url).searchParams.get('projectId') ?? undefined
    if (!res.ok || !projectId) return res
    const r = await regenerateAfterChange(projectId)
    const headers = new Headers(res.headers)
    headers.set('x-snapshots', r.ok ? `ok pages=${r.pages} ${r.durationMs}ms` : `error ${r.error ?? ''}`.slice(0, 200))
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  }
}
