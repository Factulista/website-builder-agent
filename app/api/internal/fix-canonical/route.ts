/**
 * POST /api/internal/fix-canonical
 *
 * Fixes canonical and og:url tags across all pages of a project.
 * Replaces the wrong domain (e.g. factulista.com) with the correct one
 * (e.g. www.factulista.com) everywhere in:
 *   - <link rel="canonical" href="...">
 *   - <meta property="og:url" content="...">
 *   - JSON-LD "@id" and "url" fields
 *   - sitemap.xml (if stored in site_config.seo_files)
 *   - {{site_url}} placeholders still present in HTML
 *
 * Also updates site_config.customDomain if provided.
 *
 * curl -X POST https://myweb.factulista.com/api/internal/fix-canonical \
 *   -H "Content-Type: application/json" \
 *   -d '{"token":"factulista-patch-2025","projectId":"6a436817-...","wrongDomain":"factulista.com","correctDomain":"www.factulista.com","dryRun":true}'
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function fixHtml(html: string, wrongDomain: string, correctDomain: string): { html: string; count: number } {
  let count = 0

  // Replace every occurrence of the wrong domain in href/content attributes and JSON-LD
  // We target: https://wrongDomain and http://wrongDomain
  const fixed = html.replace(
    new RegExp(`https?://${escapeRegex(wrongDomain)}`, 'g'),
    (match) => {
      count++
      return match.replace(wrongDomain, correctDomain)
    }
  )

  // Also replace bare {{site_url}} if still present (shouldn't be in saved HTML but just in case)
  const fixed2 = fixed.replace(/\{\{site_url\}\}/g, (match) => {
    count++
    return `https://${correctDomain}`
  })

  return { html: fixed2, count }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function POST(req: NextRequest) {
  try {
    const { token, projectId, wrongDomain, correctDomain, dryRun = false } = await req.json()

    if (token !== 'factulista-patch-2025') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!projectId || !wrongDomain || !correctDomain) {
      return NextResponse.json(
        { error: 'Required: projectId, wrongDomain, correctDomain' },
        { status: 400 }
      )
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

    // Fix all pages
    let totalReplacements = 0
    const pageResults: Array<{ slug: string; replacements: number }> = []

    const updatedPages = pages.map(p => {
      const { html, count } = fixHtml(p.html, wrongDomain, correctDomain)
      totalReplacements += count
      if (count > 0) pageResults.push({ slug: p.slug, replacements: count })
      return { ...p, html }
    })

    // Fix sitemap.xml if stored in site_config.seo_files
    let seoFilesFixed = 0
    const seoFiles = (config?.seo_files ?? {}) as Record<string, string>
    const updatedSeoFiles: Record<string, string> = {}
    for (const [key, content] of Object.entries(seoFiles)) {
      const { html: fixed, count } = fixHtml(content, wrongDomain, correctDomain)
      updatedSeoFiles[key] = fixed
      seoFilesFixed += count
    }

    // Build updated config
    const updatedConfig: Record<string, unknown> = {
      ...config,
      pages: updatedPages,
    }
    if (seoFilesFixed > 0) updatedConfig.seo_files = updatedSeoFiles

    // Update customDomain in config if it matches wrongDomain
    if (config?.customDomain === wrongDomain || config?.custom_domain === wrongDomain) {
      updatedConfig.customDomain = correctDomain
    }

    if (!dryRun && (totalReplacements > 0 || seoFilesFixed > 0)) {
      const { error: updateErr } = await supabase
        .from('projects')
        .update({
          site_config: updatedConfig,
          updated_at: new Date().toISOString(),
        })
        .eq('id', projectId)

      if (updateErr) {
        return NextResponse.json({ error: 'DB update failed', detail: updateErr.message }, { status: 500 })
      }
    }

    return NextResponse.json({
      project: project.name,
      wrongDomain,
      correctDomain,
      pagesScanned: pages.length,
      totalReplacements,
      seoFilesFixed,
      dryRun,
      pages: pageResults,
    })
  } catch (err) {
    return NextResponse.json({ error: 'Unexpected error', detail: String(err) }, { status: 500 })
  }
}
