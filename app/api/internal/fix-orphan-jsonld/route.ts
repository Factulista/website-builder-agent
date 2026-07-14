/**
 * POST /api/internal/fix-orphan-jsonld?projectId=xxx
 * Removes orphaned/empty `<script type="application/ld+json">` OPENING tags that
 * have no JSON content (immediately followed by another tag instead of `{`).
 * These unclosed tags swallow all subsequent markup (hero, sections) as script
 * text in the browser — breaking the editor preview and corrupting saves.
 * Fixes both draft (pages) and live (published_pages).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireInternalSecret } from '../../../../lib/api-auth'

export const runtime = 'nodejs'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// Remove a json-ld script OPEN tag when it's immediately followed (after optional
// whitespace) by a `<` (a tag) instead of `{` (real JSON). Valid schemas keep their tag.
const ORPHAN_RE = /<script[^>]+type=["']application\/ld\+json["'][^>]*>\s*(?=<)/gi

function fix(html: string): { html: string; changed: boolean } {
  const out = html.replace(ORPHAN_RE, '')
  return { html: out, changed: out !== html }
}

export async function POST(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr

  const projectId = req.nextUrl.searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const supabase = getSupabase()
  const { data, error } = await supabase.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const config = (data.site_config ?? {}) as Record<string, unknown>
  let changed = 0
  const fixArr = (arr: Array<{ slug: string; html: string; blocks?: unknown }> | undefined) =>
    (arr ?? []).map(p => {
      const r = fix(p.html ?? '')
      if (r.changed) changed++
      // blocks are stale once html changes structurally — clear so they re-split on next load
      return r.changed ? { ...p, html: r.html, blocks: undefined } : p
    })

  const fixedPages = fixArr(config.pages as Array<{ slug: string; html: string }>)
  const fixedPublished = fixArr(config.published_pages as Array<{ slug: string; html: string }>)

  if (changed === 0) return NextResponse.json({ message: 'Nessun tag orfano trovato', changed: 0 })

  const { error: saveErr } = await supabase.from('projects').update({
    site_config: { ...config, pages: fixedPages, published_pages: fixedPublished },
    updated_at: new Date().toISOString(),
  }).eq('id', projectId)
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })

  return NextResponse.json({ message: `Rimosso script JSON-LD orfano da ${changed} pagina/e (draft + live)`, changed })
}
