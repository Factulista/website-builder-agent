/**
 * POST /api/internal/sync-legal-styles
 *
 * Syncs nav + footer visual style from home page to legal/policy pages.
 *
 * Strategy: inject the home page's full <style> block at the END of <head>
 * in each target page, inside a <style id="home-nav-sync"> tag.
 * CSS source order: page's own styles first, home styles last → home wins on nav/footer.
 * Idempotent: replaces the tag if it already exists.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const DEFAULT_LEGAL_SLUGS = [
  'aviso-legal',
  'condiciones-de-uso',
  'politica-cookies',
  'politica-privacidad',
  'dpa-rgpd',
]

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/** Extract the first raw <style>…</style> content from an HTML string. */
function extractFirstStyleContent(html: string): string | null {
  const m = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i)
  return m ? m[1].trim() : null
}

/**
 * Inject (or replace) a <style id="home-nav-sync"> block into a page's <head>.
 * Returns the updated HTML and whether it changed.
 */
function injectSyncStyle(pageHtml: string, homeCss: string): { html: string; changed: boolean } {
  const syncTag = `<style id="home-nav-sync">\n/* Sincronizzato da home page — non modificare manualmente */\n${homeCss}\n</style>`

  // Replace existing sync tag if present (idempotent)
  if (/<style[^>]*id="home-nav-sync"[^>]*>[\s\S]*?<\/style>/i.test(pageHtml)) {
    const updated = pageHtml.replace(
      /<style[^>]*id="home-nav-sync"[^>]*>[\s\S]*?<\/style>/i,
      syncTag
    )
    return { html: updated, changed: updated !== pageHtml }
  }

  // Inject before </head>
  if (/<\/head>/i.test(pageHtml)) {
    const updated = pageHtml.replace(/<\/head>/i, `${syncTag}\n</head>`)
    return { html: updated, changed: true }
  }

  // Fallback: prepend
  return { html: syncTag + '\n' + pageHtml, changed: true }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { token, projectId, slugs, dryRun = false } = body

    if (token !== 'factulista-patch-2025') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!projectId) {
      return NextResponse.json({ error: 'projectId required' }, { status: 400 })
    }

    const supabase = getSupabase()
    const { data: project, error: dbErr } = await supabase
      .from('projects')
      .select('id, name, slug, site_config')
      .eq('id', projectId)
      .single()

    if (dbErr || !project) {
      return NextResponse.json({ error: 'Project not found', detail: dbErr?.message }, { status: 404 })
    }

    const config = project.site_config as Record<string, unknown>
    const pages = (config?.pages ?? []) as Array<{ slug: string; name: string; html: string }>

    // Get home CSS
    const homePage = pages.find(p => p.slug === 'home')
    if (!homePage) return NextResponse.json({ error: 'Home page not found in site_config' }, { status: 404 })

    const homeCss = extractFirstStyleContent(homePage.html)
    if (!homeCss) return NextResponse.json({ error: 'No <style> block found in home page' }, { status: 422 })

    const targetSlugs: string[] = slugs ?? DEFAULT_LEGAL_SLUGS
    const results: Array<{ slug: string; status: string }> = []
    let changedCount = 0

    const updatedPages = pages.map(p => {
      if (!targetSlugs.includes(p.slug)) return p

      const { html, changed } = injectSyncStyle(p.html, homeCss)
      if (changed) {
        changedCount++
        results.push({ slug: p.slug, status: 'updated' })
      } else {
        results.push({ slug: p.slug, status: 'already in sync' })
      }
      return { ...p, html }
    })

    // Report missing pages
    for (const slug of targetSlugs) {
      if (!pages.find(p => p.slug === slug)) {
        results.push({ slug, status: 'not found in project' })
      }
    }

    if (!dryRun && changedCount > 0) {
      const { error: updateErr } = await supabase
        .from('projects')
        .update({
          site_config: { ...config, pages: updatedPages },
          updated_at: new Date().toISOString(),
        })
        .eq('id', projectId)

      if (updateErr) {
        return NextResponse.json({ error: 'DB update failed', detail: updateErr.message }, { status: 500 })
      }
    }

    return NextResponse.json({
      project: project.name,
      homeCssLength: homeCss.length,
      pagesScanned: targetSlugs.length,
      pagesChanged: changedCount,
      dryRun,
      results,
    })
  } catch (err) {
    return NextResponse.json({ error: 'Unexpected error', detail: String(err) }, { status: 500 })
  }
}
