import type { SupabaseClient } from '@supabase/supabase-js'
import { patchSiteConfig } from './site-config-patch'

/**
 * Pages store — the ONE place that knows where a project's pages live.
 *
 * Every reader/writer of draft pages (`site_config.pages`) and published pages
 * (`site_config.published_pages`) goes through here: builder, AI routes, SEO fix,
 * broken-link check, publish, previews, custom domains, snapshot generator and the
 * internal tools. Today the implementation is still the single `site_config` jsonb;
 * phase 2.2 of the Oct 2026 Supabase load plan moves pages to a `site_pages` table
 * (one row per page and state) by changing THIS file only.
 *
 * Contract:
 * - Page objects are stored as-is (slug, name, html, inMenu, megaMenu, seo fields…),
 *   in order, WITHOUT the editor-only `blocks` cache (regenerated from html).
 * - Reads return [] when the project has no pages and throw on DB errors, so a
 *   failed read can never be mistaken for "no pages" and written back.
 * - Writes replace the whole list for that state (atomic per call) and never touch
 *   any other site_config key.
 * - Works with a user session (RLS applies) and with the service role.
 *
 * Public-site reads by project SLUG go through Postgres functions
 * (get_published_page / get_published_site / get_site_config_lite), wrapped below.
 * Phase 2.2 changes those functions' SQL, not their callers.
 */

export type PageState = 'draft' | 'published'
export type StoredPage = { slug: string; name?: string; html?: string; [key: string]: unknown }

const KEY: Record<PageState, 'pages' | 'published_pages'> = { draft: 'pages', published: 'published_pages' }

/** Drop the editor-only `blocks` cache before persisting. */
export function stripPageBlocks<T>(pages: T[]): T[] {
  return pages.map(p => {
    if (!p || typeof p !== 'object' || !('blocks' in (p as object))) return p
    const { blocks: _blocks, ...rest } = p as T & { blocks?: unknown }
    return rest as T
  })
}

/** All pages of one state, in order. */
export async function readPages<T extends { slug: string } = StoredPage>(sb: SupabaseClient, projectId: string, state: PageState): Promise<T[]> {
  const { data, error } = await sb.from('projects').select(`p:site_config->${KEY[state]}`).eq('id', projectId).single()
  if (error) throw new Error(`readPages(${state}) failed: ${error.message}`)
  const list = (data as { p: unknown } | null)?.p
  return Array.isArray(list) ? (list as T[]) : []
}

/** Draft + published in one round-trip (tools that edit both copies of a page). */
export async function readAllPages<T extends { slug: string } = StoredPage>(sb: SupabaseClient, projectId: string): Promise<{ draft: T[]; published: T[] }> {
  const { data, error } = await sb.from('projects')
    .select('d:site_config->pages, p:site_config->published_pages')
    .eq('id', projectId).single()
  if (error) throw new Error(`readAllPages failed: ${error.message}`)
  const row = (data ?? {}) as { d?: unknown; p?: unknown }
  return { draft: Array.isArray(row.d) ? (row.d as T[]) : [], published: Array.isArray(row.p) ? (row.p as T[]) : [] }
}

/** One page by slug, or null. */
export async function readPage<T extends { slug: string } = StoredPage>(sb: SupabaseClient, projectId: string, slug: string, state: PageState): Promise<T | null> {
  return (await readPages<T>(sb, projectId, state)).find(p => p.slug === slug) ?? null
}

/**
 * Replace the whole page list of one state. For drafts, `shared` optionally updates
 * shared_nav_html / shared_footer_html in the same statement (null/undefined = keep
 * the DB value) — the builder derives them from the home page.
 */
export async function writePages(
  sb: SupabaseClient,
  projectId: string,
  state: PageState,
  pages: Array<{ slug: string }>,
  shared?: { nav?: string | null; footer?: string | null },
): Promise<void> {
  const clean = stripPageBlocks(pages)
  if (state === 'draft') {
    const { error } = await sb.rpc('save_inline_pages', {
      p_id: projectId,
      p_pages: clean,
      p_shared_nav: shared?.nav ?? null,
      p_shared_footer: shared?.footer ?? null,
    })
    if (!error) return
    console.warn('[pages-store] save_inline_pages failed, falling back to path patch:', error.message)
  }
  const sets: Parameters<typeof patchSiteConfig>[2] = [{ path: [KEY[state]], value: clean }]
  if (state === 'draft' && shared?.nav) sets.push({ path: ['shared_nav_html'], value: shared.nav })
  if (state === 'draft' && shared?.footer) sets.push({ path: ['shared_footer_html'], value: shared.footer })
  const { error } = await patchSiteConfig(sb, projectId, sets)
  if (error) throw new Error(`writePages(${state}) failed: ${error}`)
}

/**
 * Read → transform → write for one state. Return the same array reference (or
 * undefined) from `fn` to skip the write. Returns the final list.
 */
export async function updatePages<T extends { slug: string } = StoredPage>(
  sb: SupabaseClient,
  projectId: string,
  state: PageState,
  fn: (pages: T[]) => T[] | void | Promise<T[] | void>,
): Promise<T[]> {
  const pages = await readPages<T>(sb, projectId, state)
  const next = await fn(pages)
  if (!next || next === pages) return pages
  await writePages(sb, projectId, state, next)
  return next
}

/** Publish: published := drafts (without blocks). Returns the number of pages. */
export async function publishDrafts(sb: SupabaseClient, projectId: string): Promise<number> {
  const drafts = await readPages(sb, projectId, 'draft')
  if (drafts.length === 0) throw new Error('Nessuna pagina da pubblicare')
  await writePages(sb, projectId, 'published', drafts)
  return drafts.length
}

/** Pages to copy when duplicating a project. */
export async function copyAllPages(sb: SupabaseClient, fromProjectId: string, toProjectId: string): Promise<void> {
  const { draft, published } = await readAllPages(sb, fromProjectId)
  await writePages(sb, toProjectId, 'draft', draft)
  if (published.length) await writePages(sb, toProjectId, 'published', published)
}

// ── Whole-site loads (config + one state's pages) ─────────────────────────────

export type ProjectLookup = { id: string } | { slug: string } | { customDomain: string }

/**
 * Project row + its site_config holding only the requested state's pages (the other
 * list is removed), shaped exactly like before (`config.pages` or
 * `config.published_pages`), so render code needs no changes. `columns` are extra
 * project columns (id, slug and name are always included).
 */
export async function loadSiteWithPages(
  sb: SupabaseClient,
  lookup: ProjectLookup,
  state: PageState,
  columns: string[] = [],
): Promise<{ project: Record<string, unknown> & { id: string; slug: string; name: string | null }; config: Record<string, unknown> } | null> {
  let q = sb.from('projects').select(['id', 'slug', 'name', 'site_config', ...columns].join(', ')).is('deleted_at', null)
  if ('id' in lookup) q = q.eq('id', lookup.id)
  else if ('slug' in lookup) q = q.eq('slug', lookup.slug)
  else q = q.eq('custom_domain', lookup.customDomain)
  const { data, error } = await q.single()
  if (error || !data) return null
  const { site_config, ...project } = data as unknown as Record<string, unknown>
  const config = { ...((site_config ?? {}) as Record<string, unknown>) }
  delete config[KEY[state === 'draft' ? 'published' : 'draft']]
  return { project: project as { id: string; slug: string; name: string | null }, config }
}

/** Builder open: project fields + site_config without published pages (RLS applies). */
export async function loadEditorProject(sb: SupabaseClient, projectId: string): Promise<{
  name: string; slug: string; site_config: unknown; custom_domain: string | null; custom_domain_status: string | null
} | null> {
  type Row = { name: string; slug: string; site_config: unknown; custom_domain: string | null; custom_domain_status: string | null }
  const viaRpc = await sb.rpc('get_builder_project', { p_id: projectId }).maybeSingle()
  if (!viaRpc.error && viaRpc.data) return viaRpc.data as Row
  const { data } = await sb.from('projects')
    .select('name, slug, site_config, custom_domain, custom_domain_status')
    .eq('id', projectId).single()
  return (data as Row | null) ?? null
}

// ── Public site (by project slug, via Postgres functions) ────────────────────

type PublishedRow = { config: Record<string, unknown>; name: string | null }

/** Published config with every published page's html. */
export async function readPublishedSite(sb: SupabaseClient, projectSlug: string) {
  const r = await sb.rpc('get_published_site', { p_slug: projectSlug }).maybeSingle()
  return { data: (r.data as PublishedRow | null) ?? null, error: r.error?.message ?? null }
}

/** Published config where only `pageSlug` keeps its html (others: metadata only). */
export async function readPublishedPageConfig(sb: SupabaseClient, projectSlug: string, pageSlug: string) {
  const r = await sb.rpc('get_published_page', { p_slug: projectSlug, p_page: pageSlug }).maybeSingle()
  return { data: (r.data as PublishedRow | null) ?? null, error: r.error?.message ?? null }
}
