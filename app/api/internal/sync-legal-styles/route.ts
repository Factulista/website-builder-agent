/**
 * POST /api/internal/sync-legal-styles
 *
 * Copies nav + footer CSS from the home page to a set of target pages.
 * Ensures legal/policy pages always have the same header/footer style as home.
 *
 * Usage:
 *   curl -X POST https://myweb.factulista.com/api/internal/sync-legal-styles \
 *     -H "Content-Type: application/json" \
 *     -d '{"token":"factulista-patch-2025","projectId":"6a436817-...","dryRun":false}'
 *
 * Optional: pass "slugs" array to override default legal page list.
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

// ── CSS extraction helpers ────────────────────────────────────────────────────

/** Extract all <style> content from an HTML string. */
function extractStyles(html: string): string {
  const blocks = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) ?? []
  return blocks.map(b => b.replace(/<\/?style[^>]*>/gi, '')).join('\n')
}

/**
 * Extract CSS rules that target nav/footer selectors.
 * Returns the raw CSS text for those rules.
 */
function extractNavFooterCss(css: string): string {
  const rules: string[] = []

  // Match CSS rule blocks: selector { ... }
  // We keep any rule whose selector contains nav, footer, .mobile-menu, hamburger, .nav-*, .footer-*
  const ruleRegex = /([^{}]+)\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g
  let match: RegExpExecArray | null

  const NAV_FOOTER_PATTERN = /\b(nav|footer|\.nav|\.footer|\.mobile-menu|\.hamburger|\.nav-|\.footer-|#nav|#footer|\.site-nav|\.site-footer|header\s*nav)\b/i

  while ((match = ruleRegex.exec(css)) !== null) {
    const selector = match[1].trim()
    const body = match[2].trim()
    if (NAV_FOOTER_PATTERN.test(selector) && body) {
      rules.push(`${selector} {\n  ${body.replace(/;\s*/g, ';\n  ').trim()}\n}`)
    }
  }

  // Also grab :root block (CSS variables — needed for color consistency)
  const rootMatch = css.match(/:root\s*\{([^}]+)\}/)
  if (rootMatch) {
    rules.unshift(`:root {\n${rootMatch[1]}\n}`)
  }

  return rules.join('\n\n')
}

/**
 * Replace nav/footer CSS rules in a page's <style> block with the home version.
 * Strategy:
 *   1. Strip existing nav/footer rules from the page's <style>
 *   2. Append the home nav/footer rules at the end of the first <style> block
 */
function syncNavFooterCss(pageHtml: string, homeNavFooterCss: string): { html: string; changed: boolean } {
  if (!homeNavFooterCss.trim()) return { html: pageHtml, changed: false }

  const NAV_FOOTER_PATTERN = /\b(nav|footer|\.nav|\.footer|\.mobile-menu|\.hamburger|\.nav-|\.footer-|#nav|#footer|\.site-nav|\.site-footer)\b/i

  // Find first <style> block
  const styleMatch = pageHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/i)
  if (!styleMatch) return { html: pageHtml, changed: false }

  const originalStyle = styleMatch[0]
  const styleContent = styleMatch[1]

  // Remove existing nav/footer rules from page CSS
  let cleanedContent = ''
  const ruleRegex = /([^{}]+)\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g
  let lastIndex = 0
  let m: RegExpExecArray | null

  // Build cleaned CSS by skipping nav/footer rules
  const pieces: string[] = []
  // Reset regex
  ruleRegex.lastIndex = 0
  let prevEnd = 0
  while ((m = ruleRegex.exec(styleContent)) !== null) {
    const selector = m[1].trim()
    if (NAV_FOOTER_PATTERN.test(selector)) {
      // Skip this rule — keep text before it
      pieces.push(styleContent.slice(prevEnd, m.index))
    } else {
      pieces.push(styleContent.slice(prevEnd, m.index + m[0].length))
    }
    prevEnd = m.index + m[0].length
  }
  pieces.push(styleContent.slice(prevEnd))
  cleanedContent = pieces.join('').replace(/\n{3,}/g, '\n\n').trim()

  // Also strip :root from page (we'll use home's :root)
  cleanedContent = cleanedContent.replace(/:root\s*\{[^}]+\}/g, '').trim()

  // Build new style block: page component CSS + home nav/footer CSS at end
  const syncComment = '/* ── nav/footer: sincronizzato da home page ── */'
  const newStyleContent = `${cleanedContent}\n\n${syncComment}\n${homeNavFooterCss}`
  const newStyle = originalStyle.replace(styleContent, newStyleContent)

  if (newStyle === originalStyle) return { html: pageHtml, changed: false }

  return {
    html: pageHtml.replace(originalStyle, newStyle),
    changed: true,
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { token, projectId, slugs, dryRun = false } = await req.json()

  if (token !== 'factulista-patch-2025') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  }

  const supabase = getSupabase()
  const { data: project } = await supabase
    .from('projects')
    .select('id, name, slug, site_config')
    .eq('id', projectId)
    .single()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const config = project.site_config as Record<string, unknown>
  const pages = (config?.pages ?? []) as Array<{ slug: string; name: string; html: string }>

  // Get home page
  const homePage = pages.find(p => p.slug === 'home')
  if (!homePage) return NextResponse.json({ error: 'Home page not found' }, { status: 404 })

  // Extract nav/footer CSS from home
  const homeCss = extractStyles(homePage.html)
  const homeNavFooterCss = extractNavFooterCss(homeCss)

  if (!homeNavFooterCss.trim()) {
    return NextResponse.json({ error: 'No nav/footer CSS found in home page' }, { status: 422 })
  }

  // Target pages
  const targetSlugs: string[] = slugs ?? DEFAULT_LEGAL_SLUGS
  const results: Array<{ slug: string; status: string }> = []
  let changed = 0

  const updatedPages = pages.map(p => {
    if (!targetSlugs.includes(p.slug)) return p

    const { html, changed: wasChanged } = syncNavFooterCss(p.html, homeNavFooterCss)
    if (wasChanged) {
      changed++
      results.push({ slug: p.slug, status: 'updated' })
    } else {
      results.push({ slug: p.slug, status: 'already in sync' })
    }
    return { ...p, html }
  })

  // Pages in targetSlugs but not in project
  for (const slug of targetSlugs) {
    if (!pages.find(p => p.slug === slug)) {
      results.push({ slug, status: 'not found in project' })
    }
  }

  if (!dryRun && changed > 0) {
    await supabase
      .from('projects')
      .update({
        site_config: { ...config, pages: updatedPages },
        updated_at: new Date().toISOString(),
      })
      .eq('id', projectId)
  }

  return NextResponse.json({
    project: project.name,
    homeNavFooterCssLength: homeNavFooterCss.length,
    pagesScanned: targetSlugs.length,
    pagesChanged: changed,
    dryRun,
    results,
  })
}
