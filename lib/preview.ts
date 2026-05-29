import { createClient } from '@supabase/supabase-js'
import type { InjectPoints } from './blog-serve'

type Page = {
  slug: string
  name: string
  html: string
  menuLabel?: string
  inMenu?: boolean
  og_image?: string
}
type SiteConfig = {
  html?: string
  pages?: Page[]
  published_pages?: Page[]
  shared_css?: string
  shared_nav_html?: string
  shared_footer_html?: string
  favicon_url?: string
  blog_header_html?: string
  blog_sidebar_banner?: { url: string; link?: string }
  context?: Record<string, unknown>
  messages?: unknown[]
  versions?: unknown[]
  media?: Record<string, unknown>
} | null

/**
 * Converts root-relative internal page links to path-relative ones so they
 * work correctly under a <base href> prefix.
 *
 * e.g.  href="/blog"     →  href="./blog"
 *        href="/precios"  →  href="./precios"
 *
 * Only touches <a href="/single-segment"> patterns (one path segment, no
 * protocol, no double-slash, no API/Next internals). External links and
 * resource URLs are left untouched.
 */
function normalizeInternalLinks(html: string, knownSlugs: string[]): string {
  if (knownSlugs.length === 0) return html
  const slugPattern = knownSlugs.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  // Match href="/slug" or href='/slug' (exact slug, optional trailing slash)
  return html.replace(
    new RegExp(`(href=["'])\/(${slugPattern})\/?(?=["'])`, 'g'),
    (_match, prefix, slug) => `${prefix}./${slug}`
  )
}

/**
 * If shared_css is provided, replaces the page's own <style> block(s) with the
 * canonical shared CSS. This is the single source of truth for all site styling.
 * Falls back gracefully: pages without shared_css are served as-is.
 */
function applySharedCss(html: string, sharedCss: string): string {
  // Two kinds of pages exist:
  //  A) "token-only" pages: generated with NO page-level <style> — they rely
  //     entirely on shared_css for ALL styling (tokens + components).
  //  B) "self-contained" pages: have their own complete component CSS (hero,
  //     faq, footer, etc.) — possibly a different layout than the home page.
  //
  // For (A) we inject the full shared_css.
  // For (B) we must NOT strip the page's component CSS (that would leave the
  // page unstyled — the "pagina sballata" bug). Instead we only sync the
  // :root design tokens so colors/fonts stay consistent site-wide, while the
  // page keeps its own component styling.
  const pageStyles = html.match(/<style[\s\S]*?<\/style>/gi) ?? []
  const pageStyleContent = pageStyles.map(s => s.replace(/<\/?style[^>]*>/gi, '')).join('\n')
  // Remove :root blocks and the universal reset to see if real component CSS remains
  const remainder = pageStyleContent
    .replace(/:root\s*\{[\s\S]*?\}/gi, '')
    .replace(/\*[^{]*\{[^}]*\}/g, '')
    .trim()
  const isSelfContained = remainder.length > 300

  if (isSelfContained) {
    // Sync only the :root token block from shared_css into the page.
    const sharedRoot = sharedCss.match(/:root\s*\{[\s\S]*?\}/i)?.[0]
    if (sharedRoot && /:root\s*\{[\s\S]*?\}/i.test(html)) {
      return html.replace(/:root\s*\{[\s\S]*?\}/i, sharedRoot)
    }
    // Page has component CSS but no :root — prepend shared tokens, keep page CSS.
    if (sharedRoot) {
      const styleTag = `<style>${sharedRoot}</style>`
      if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${styleTag}\n</head>`)
      return styleTag + html
    }
    return html // nothing safe to do — leave the page intact
  }

  // Token-only page: strip the (minimal) page styles, inject the full shared_css.
  const stripped = html.replace(/<style[\s\S]*?<\/style>/gi, '')
  const styleTag = `<style>${sharedCss}</style>`
  if (/<\/head>/i.test(stripped)) {
    return stripped.replace(/<\/head>/i, `${styleTag}\n</head>`)
  }
  return styleTag + stripped
}

/**
 * Injects shared nav and footer into a page, replacing its own copies.
 * This ensures every served page has identical header/footer regardless
 * of what's stored per-page — the home page is the single source of truth.
 *
 * Nav:    replaces <nav>...</nav>
 * Footer: replaces <footer>...</footer>
 *
 * Skips silently if the page has no matching tag (e.g. bare fragment pages).
 */
function injectSharedComponents(html: string, sharedNav?: string, sharedFooter?: string): string {
  let result = html
  if (sharedNav) {
    if (/<nav[\s\S]*?<\/nav>/i.test(result)) {
      result = result.replace(/<nav[\s\S]*?<\/nav>/i, sharedNav)
    } else if (/<body[^>]*>/i.test(result)) {
      // Page has no <nav> (content-only page) — insert after <body>
      result = result.replace(/<body([^>]*)>/i, `<body$1>\n${sharedNav}`)
    }
  }
  if (sharedFooter) {
    if (/<footer[\s\S]*?<\/footer>/i.test(result)) {
      result = result.replace(/<footer[\s\S]*?<\/footer>/i, sharedFooter)
    } else if (/<\/body>/i.test(result)) {
      // Page has no <footer> — insert before </body>
      result = result.replace(/<\/body>/i, `${sharedFooter}\n</body>`)
    }
  }
  return result
}

/**
 * Prepares page HTML for serving:
 * 1. Normalises root-relative internal links (href="/blog" → href="./blog").
 * 2. Injects <base href> so all relative links (./blog, ./contact …) resolve correctly.
 * 3. Replaces every {{site_url}} placeholder with the absolute canonical root URL.
 * 4. In staging mode: strips <link rel="canonical"> and og:url (staging must NOT be
 *    indexed) and injects <meta name="robots" content="noindex, follow">.
 */
function prepareHtml(html: string, base: string, siteUrl: string, isStaging: boolean, knownSlugs: string[] = [], faviconUrl?: string, ogImageUrl?: string, injectPoints?: InjectPoints, sharedCss?: string, sharedNav?: string, sharedFooter?: string): string {
  const baseTag = `<base href="${base}">`

  // Step 0a: apply shared_css if available (replaces page-level <style> blocks)
  if (sharedCss) html = applySharedCss(html, sharedCss)

  // Step 0b: inject shared nav and footer — single source of truth for header/footer
  if (sharedNav || sharedFooter) html = injectSharedComponents(html, sharedNav, sharedFooter)

  // Step 1: fix root-relative internal links before base href takes effect
  let result = normalizeInternalLinks(html, knownSlugs)

  // Step 2: Replace {{site_url}} placeholder with the actual canonical root (no trailing slash)
  result = result.replace(/\{\{site_url\}\}/g, siteUrl)

  if (isStaging) {
    // Remove canonical and og:url — staging previews must not be indexed
    result = result.replace(/<link[^>]+rel=["']canonical["'][^>]*\/?>/gi, '')
    result = result.replace(/<meta[^>]+property=["']og:url["'][^>]*\/?>/gi, '')
    // Inject noindex
    const noindex = '<meta name="robots" content="noindex, follow">'
    if (/<head[^>]*>/i.test(result)) {
      result = result.replace(/<head[^>]*>/i, (m) => `${m}\n${noindex}`)
    }
  }

  // Inject favicon and OG image if provided
  if (/<head[^>]*>/i.test(result)) {
    if (faviconUrl) {
      // Always use the user's favicon — remove any existing <link rel="icon|shortcut icon"> first
      result = result.replace(/<link[^>]+rel=["'](?:shortcut icon|icon)["'][^>]*\/?>/gi, '')
      result = result.replace(/<head[^>]*>/i, (m) => `${m}\n<link rel="icon" href="${faviconUrl}">`)
    }
    if (ogImageUrl && !/<meta[^>]+property=["']og:image["']/i.test(result)) {
      result = result.replace(/<head[^>]*>/i, (m) => `${m}\n<meta property="og:image" content="${ogImageUrl}">`)
    }
  }

  // Inject slot: head (before </head>)
  if (injectPoints?.head && /<\/head>/i.test(result)) {
    result = result.replace(/<\/head>/i, `${injectPoints.head}\n</head>`)
  }

  // Inject slot: body_end (before </body>)
  if (injectPoints?.body_end && /<\/body>/i.test(result)) {
    result = result.replace(/<\/body>/i, `${injectPoints.body_end}\n</body>`)
  }

  // Inject <base href> (skip if the page already has one)
  if (/<base[^>]*>/i.test(result)) return result
  if (/<head[^>]*>/i.test(result)) {
    return result.replace(/<head[^>]*>/i, (m) => `${m}\n${baseTag}`)
  }
  return baseTag + result
}

function errorPage(status: number, title: string, message: string) {
  return new Response(
    `<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem;text-align:center;color:#1c1917;background:#faf9f7;"><h1 style="margin-bottom:1rem;">${title}</h1><p>${message}</p></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'factulista.com'

// Staging preview: always serves the latest draft (pages)
export async function servePreview(projectSlug: string, pageSlug: string = 'home') {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabase
    .from('projects')
    .select('site_config, name')
    .eq('slug', projectSlug)
    .is('deleted_at', null)
    .single()

  if (error || !data) return errorPage(404, '404', 'Sito non trovato')

  const config = data.site_config as SiteConfig
  let pageHtml: string | undefined

  if (config?.pages && config.pages.length > 0) {
    const page = config.pages.find(p => p.slug === pageSlug)
    if (!page) return errorPage(404, '404', `La pagina "/${pageSlug}" non esiste in questo sito.`)
    pageHtml = page.html
  } else if (pageSlug === 'home' && config?.html) {
    pageHtml = config.html
  }

  if (!pageHtml) return errorPage(200, data.name, 'Il sito non è ancora stato generato.')

  // Staging: base uses the public-facing URL so that relative links (./blog, ./page)
  // resolve to https://myweb.{domain}/{slug}/... — which the middleware rewrites
  // internally to /preview/{slug}/... without ever leaking "preview" in the browser URL.
  const base = `https://myweb.${ROOT_DOMAIN}/${projectSlug}/`
  const siteUrl = `https://myweb.${ROOT_DOMAIN}/${projectSlug}`
  const knownSlugs = ['blog', ...(config?.pages ?? []).map(p => p.slug)]
  const faviconUrl = config?.favicon_url
  const page = config?.pages?.find(p => p.slug === pageSlug)
  const ogImageUrl = page?.og_image
  const injectPoints = (config as Record<string, unknown>)?.inject_points as InjectPoints | undefined
  const sharedCss = config?.shared_css
  const sharedNav = config?.shared_nav_html
  const sharedFooter = config?.shared_footer_html

  return new Response(prepareHtml(pageHtml, base, siteUrl, true, knownSlugs, faviconUrl, ogImageUrl, injectPoints, sharedCss, sharedNav, sharedFooter), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60, s-maxage=300' },
  })
}

// Production: serves published_pages only (set when user clicks "Pubblica")
export async function servePublished(projectSlug: string, pageSlug: string = 'home', customDomain: string) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabase
    .from('projects')
    .select('site_config, name')
    .eq('slug', projectSlug)
    .is('deleted_at', null)
    .single()

  if (error || !data) return errorPage(404, '404', 'Sito non trovato')

  const config = data.site_config as SiteConfig

  if (!config?.published_pages || config.published_pages.length === 0) {
    return errorPage(200, data.name, 'Il sito non è ancora stato pubblicato.')
  }

  const page = config.published_pages.find(p => p.slug === pageSlug)
  if (!page) return errorPage(404, '404', `La pagina "/${pageSlug}" non esiste.`)

  // Custom domain: base = https://{domain}/, siteUrl = https://{domain} (no trailing slash)
  const base = `https://${customDomain}/`
  const siteUrl = `https://${customDomain}`
  const knownSlugs = ['blog', ...(config.published_pages).map(p => p.slug)]
  const faviconUrl = config.favicon_url
  const ogImageUrl = page.og_image
  const injectPoints = (config as Record<string, unknown>)?.inject_points as InjectPoints | undefined
  const sharedCss = config.shared_css
  const sharedNav = config.shared_nav_html
  const sharedFooter = config.shared_footer_html

  return new Response(prepareHtml(page.html, base, siteUrl, false, knownSlugs, faviconUrl, ogImageUrl, injectPoints, sharedCss, sharedNav, sharedFooter), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60, s-maxage=300' },
  })
}
