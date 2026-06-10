import { createClient } from '@supabase/supabase-js'
import type { InjectPoints } from './blog-serve'
import { buildSharedFrameCss, FRAME_GLOBAL_FIX } from './shared-frame'
import { mergeRootVars } from './design-system'

type Page = {
  slug: string
  name: string
  html: string
  menuLabel?: string
  inMenu?: boolean
  og_image?: string
  /** Custom Open Graph title override (defaults to the page <title>). */
  og_title?: string
  /** Per-page robots directive, controlled from the Pages panel. Default: index, follow. */
  robots?: { noindex?: boolean; nofollow?: boolean }
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
  /** User-managed 301 redirects (SEO Optimizer → Strumenti). from = path, to = full URL or path. */
  redirects?: Array<{ from: string; to: string }>
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
    // MERGE the shared :root tokens into the page's own :root — the page's
    // variables win (its design stays intact), shared tokens only fill gaps.
    // Replacing wholesale (the old behaviour) wiped page-specific variables like
    // --yellow/--black/--radius and broke self-contained legal/landing pages.
    const sharedRoot = sharedCss.match(/:root\s*\{[\s\S]*?\}/i)?.[0]
    const pageRoot = html.match(/:root\s*\{[\s\S]*?\}/i)?.[0]
    if (sharedRoot && pageRoot) {
      return html.replace(/:root\s*\{[\s\S]*?\}/i, mergeRootVars(pageRoot, sharedRoot))
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
function prepareHtml(html: string, base: string, siteUrl: string, isStaging: boolean, knownSlugs: string[] = [], faviconUrl?: string, ogImageUrl?: string, injectPoints?: InjectPoints, sharedCss?: string, sharedNav?: string, sharedFooter?: string, pageSlug: string = 'home', robots?: { noindex?: boolean; nofollow?: boolean }, ogTitle?: string, siteName?: string): string {
  const baseTag = `<base href="${base}">`

  // Canonical header/footer stylesheet — extracted from the home CSS, injected AFTER
  // the page's own styles so the shared frame renders identically on every page.
  const frameCss = sharedCss ? buildSharedFrameCss(sharedNav ?? '', sharedFooter ?? '', sharedCss) : ''

  // Step 0a: apply shared_css if available (replaces page-level <style> blocks)
  if (sharedCss) html = applySharedCss(html, sharedCss)

  // Step 0b: inject shared nav and footer — single source of truth for header/footer
  if (sharedNav || sharedFooter) html = injectSharedComponents(html, sharedNav, sharedFooter)

  // Step 1: fix root-relative internal links before base href takes effect
  let result = normalizeInternalLinks(html, knownSlugs)

  // Step 1b: replace obsolete HTML tags with their HTML5 equivalents
  // (fixes legacy content without requiring a DB edit)
  result = result
    .replace(/<strike(\s[^>]*)?>/gi, '<s$1>')
    .replace(/<\/strike>/gi, '</s>')
    .replace(/<font(\s[^>]*)?>/gi, '<span$1>')
    .replace(/<\/font>/gi, '</span>')
    .replace(/<center(\s[^>]*)?>/gi, '<div$1 style="text-align:center">')
    .replace(/<\/center>/gi, '</div>')
    .replace(/<tt(\s[^>]*)?>/gi, '<code$1>')
    .replace(/<\/tt>/gi, '</code>')

  // Step 2: Replace {{site_url}} placeholder with the actual canonical root (no trailing slash)
  result = result.replace(/\{\{site_url\}\}/g, siteUrl)

  // Step 2b: Fix hardcoded stale URLs in og:url and canonical that were saved before
  // the {{site_url}} placeholder system was adopted. Replace any preview/staging URL
  // with the correct siteUrl so og:url always reflects the real public domain.
  result = result.replace(
    /(property=["']og:url["'][^>]*content=["']|content=["'][^"']*["'][^>]*property=["']og:url["'].*?content=["'])https?:\/\/[^"'/]*\/(?:preview\/)?[^"']*/gi,
    (_m, prefix) => `${prefix}${siteUrl}`
  )
  // Simpler pattern for the common <meta property="og:url" content="..."> order
  result = result.replace(
    /(<meta[^>]+property=["']og:url["'][^>]*content=["'])([^"']+)(["'])/gi,
    (_m, before, _url, after) => `${before}${siteUrl}${after}`
  )

  if (isStaging) {
    // Remove canonical and og:url — staging previews must not be indexed
    result = result.replace(/<link[^>]+rel=["']canonical["'][^>]*\/?>/gi, '')
    result = result.replace(/<meta[^>]+property=["']og:url["'][^>]*\/?>/gi, '')
    // Inject noindex
    const noindex = '<meta name="robots" content="noindex, follow">'
    if (/<head[^>]*>/i.test(result)) {
      result = result.replace(/<head[^>]*>/i, (m) => `${m}\n${noindex}`)
    }
  } else {
    // ── Production: set the canonical + og:url AUTHORITATIVELY from the served URL ──
    // The serving layer knows the real public URL, so it owns the canonical — immune
    // to stored HTML having apex (no-www), stale, or missing canonical tags. This is
    // the single source of truth and guarantees every page has the correct www canonical.
    const canonicalUrl = (!pageSlug || pageSlug === 'home') ? `${siteUrl}/` : `${siteUrl}/${pageSlug}`
    // Strip any existing canonical (whatever the stored HTML had) and inject the definitive one
    result = result.replace(/<link[^>]+rel=["']canonical["'][^>]*\/?>\s*/gi, '')
    if (/<head[^>]*>/i.test(result)) {
      result = result.replace(/<head[^>]*>/i, (m) => `${m}\n<link rel="canonical" href="${canonicalUrl}">`)
    }

    // ── Open Graph: COMPLETE, AUTHORITATIVE, DEDUPLICATED set on every page ──
    // Strip ALL existing og:* tags (removes duplicates + stale values), then inject
    // one clean, full set. Sources: og_title override → <title>; description from the
    // page <meta description>; locale from <html lang>; image 1200×630 (OG format).
    const esc = (s: string) => s.replace(/"/g, '&quot;').replace(/\s+/g, ' ').trim()
    const titleFromHtml = (result.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim()
    const descFromHtml = (
      result.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ??
      result.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1] ?? ''
    ).trim()
    const langFromHtml = (result.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1] ?? 'es').slice(0, 2).toLowerCase()
    const localeMap: Record<string, string> = { es: 'es_ES', it: 'it_IT', en: 'en_US', fr: 'fr_FR', de: 'de_DE', pt: 'pt_PT', ca: 'ca_ES' }
    const ogLocale = localeMap[langFromHtml] ?? 'es_ES'
    const ogTitleVal = esc(ogTitle?.trim() || titleFromHtml || pageSlug)
    const ogDescVal = esc(descFromHtml)
    const ogSiteName = esc(siteName ?? '')

    result = result.replace(/<meta[^>]+property=["']og:[^"']*["'][^>]*\/?>\s*/gi, '')

    const ogTags = [
      `<meta property="og:title" content="${ogTitleVal}">`,
      ogDescVal ? `<meta property="og:description" content="${ogDescVal}">` : '',
      `<meta property="og:type" content="website">`,
      `<meta property="og:url" content="${canonicalUrl}">`,
      ogSiteName ? `<meta property="og:site_name" content="${ogSiteName}">` : '',
      `<meta property="og:locale" content="${ogLocale}">`,
      ogImageUrl ? `<meta property="og:image" content="${ogImageUrl}">` : '',
      ogImageUrl ? `<meta property="og:image:alt" content="${ogTitleVal}">` : '',
      ogImageUrl ? `<meta property="og:image:width" content="1200">` : '',
      ogImageUrl ? `<meta property="og:image:height" content="630">` : '',
    ].filter(Boolean).join('\n')
    if (/<head[^>]*>/i.test(result)) {
      result = result.replace(/<head[^>]*>/i, (m) => `${m}\n${ogTags}`)
    }

    // ── Robots meta: AUTHORITATIVE from the page setting (Pages panel) ──
    // Always strip any stale robots meta from the stored HTML, then inject the
    // directive from the page's setting. Default (index, follow) = no tag.
    // This makes the per-page toggle the single source of truth and neutralises
    // any leftover noindex baked into the HTML.
    result = result.replace(/<meta[^>]+name=["']robots["'][^>]*\/?>\s*/gi, '')
    if (robots?.noindex || robots?.nofollow) {
      const idx = robots?.noindex ? 'noindex' : 'index'
      const flw = robots?.nofollow ? 'nofollow' : 'follow'
      const robotsTag = `<meta name="robots" content="${idx}, ${flw}">`
      if (/<head[^>]*>/i.test(result)) {
        result = result.replace(/<head[^>]*>/i, (m) => `${m}\n${robotsTag}`)
      }
    }
  }

  // Inject favicon (OG image is handled in the complete OG block above, production only)
  if (/<head[^>]*>/i.test(result) && faviconUrl) {
    // Always use the user's favicon — remove any existing icon links first
    result = result.replace(/<link[^>]+rel=["'](?:shortcut icon|icon|apple-touch-icon)["'][^>]*\/?>/gi, '')
    const ext = faviconUrl.split('?')[0].split('.').pop()?.toLowerCase() ?? 'png'
    const mimeMap: Record<string, string> = { ico: 'image/x-icon', svg: 'image/svg+xml', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' }
    const type = mimeMap[ext] ?? 'image/png'
    result = result.replace(/<head[^>]*>/i, (m) => `${m}\n<link rel="icon" type="${type}" href="${faviconUrl}">\n<link rel="apple-touch-icon" href="${faviconUrl}">`)
  }

  // Inject canonical header/footer CSS + global layout fix — AFTER the page's own styles
  // so it wins in cascade. This makes the shared nav/footer render identically on every
  // page, even self-contained pages whose own <style> diverges (different button padding,
  // font-weight, missing line-height, etc.).
  if (/<\/head>/i.test(result)) {
    const frameStyle = `<style id="nfd-frame-fix">${FRAME_GLOBAL_FIX}</style>${frameCss ? `\n<style id="nfd-frame-css">${frameCss}</style>` : ''}`
    result = result.replace(/<\/head>/i, `${frameStyle}\n</head>`)
  }

  // Inject slot: head (before </head>)
  if (injectPoints?.head && /<\/head>/i.test(result)) {
    result = result.replace(/<\/head>/i, `${injectPoints.head}\n</head>`)
  }

  // Inject slot: body_end (before </body>)
  if (injectPoints?.body_end && /<\/body>/i.test(result)) {
    result = result.replace(/<\/body>/i, `${injectPoints.body_end}\n</body>`)
  }

  // Always inject the correct <base href> — replace any stale one that may have
  // been baked into the stored HTML by the editor (e.g. /preview/{slug}/ or
  // https://myweb.factulista.com/{slug}/). Keeping a stale base would cause logo
  // and all ./ links to resolve to the wrong domain on the live site.
  if (/<base[^>]*>/i.test(result)) {
    return result.replace(/<base[^>]*>/i, baseTag)
  }
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
// originalHost: when set, base href and siteUrl use this domain instead of
// myweb.{ROOT_DOMAIN}/{slug} — used when the root domain (www.factulista.com)
// rewrites to /preview/{slug} so that internal nav links stay on the right domain.
export async function servePreview(projectSlug: string, pageSlug: string = 'home', originalHost?: string) {
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
  // resolve correctly. When an originalHost is provided (e.g. www.factulista.com),
  // use it directly so links stay on that domain. Otherwise fall back to the myweb
  // subdomain which the middleware rewrites internally to /preview/{slug}/...
  const base = originalHost
    ? `https://${originalHost}/`
    : `https://myweb.${ROOT_DOMAIN}/${projectSlug}/`
  const siteUrl = originalHost
    ? `https://${originalHost}`
    : `https://myweb.${ROOT_DOMAIN}/${projectSlug}`
  const knownSlugs = ['blog', ...(config?.pages ?? []).map(p => p.slug)]
  const faviconUrl = config?.favicon_url
  const page = config?.pages?.find(p => p.slug === pageSlug)
  const ogImageUrl = page?.og_image || (config as Record<string, unknown>)?.default_og_image as string | undefined
  const injectPoints = (config as Record<string, unknown>)?.inject_points as InjectPoints | undefined
  const sharedCss = config?.shared_css
  const sharedNav = config?.shared_nav_html
  const sharedFooter = config?.shared_footer_html

  // isStaging=true strips canonical/og:url and injects noindex — correct for the
  // myweb.factulista.com staging preview. When serving at the real public domain
  // (originalHost set), treat it as production so canonical tags are preserved and
  // noindex is NOT injected (Google must be able to crawl and index the live site).
  const isStaging = !originalHost

  const siteName = (config?.context?.businessName as string | undefined) ?? data.name ?? ''
  return new Response(prepareHtml(pageHtml, base, siteUrl, isStaging, knownSlugs, faviconUrl, ogImageUrl, injectPoints, sharedCss, sharedNav, sharedFooter, pageSlug, page?.robots, page?.og_title, siteName), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // No caching for production domain pages — content must always be fresh.
      // Staging previews can be cached aggressively since they're only for editing.
      // Staging: short cache fine (editor previews don't need to be real-time)
      // Production: NO cache — user must see changes immediately after Publish
      'Cache-Control': isStaging
        ? 'public, max-age=60, s-maxage=300, stale-while-revalidate=600'
        : 'no-cache, no-store, must-revalidate',
    },
  })
}

// Production: serves published_pages only (set when user clicks "Pubblica")
export async function servePublished(projectSlug: string, pageSlug: string = 'home', customDomain: string) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Optimized path: RPC extracts ONLY the serving fields inside Postgres, returning
  // a small payload (no draft pages / blocks / messages / media / keywords). This is
  // the main egress optimization for public traffic. Falls back to a full select if
  // the RPC migration hasn't been applied yet — so the deploy is always safe.
  let config: SiteConfig
  let projectName: string

  const rpc = await supabase.rpc('get_published_site', { p_slug: projectSlug }).maybeSingle()

  if (!rpc.error && rpc.data) {
    config = (rpc.data as { config: SiteConfig }).config
    projectName = (rpc.data as { name: string }).name ?? ''
  } else {
    // Fallback: full select (pre-migration, or RPC unavailable)
    const { data, error } = await supabase
      .from('projects')
      .select('site_config, name')
      .eq('slug', projectSlug)
      .is('deleted_at', null)
      .single()
    if (error || !data) return errorPage(404, '404', 'Sito non trovato')
    config = data.site_config as SiteConfig
    projectName = data.name ?? ''
  }

  // ── Legacy .html URLs → clean slug (301) ──
  // Old URLs like /politica-cookies.html (indexed by Google before the migration to
  // extensionless slugs) get a permanent redirect to the clean URL, if that page exists.
  if (pageSlug.endsWith('.html')) {
    const cleanSlug = pageSlug.slice(0, -5)
    const exists = config?.published_pages?.some(p => p.slug === cleanSlug)
    if (exists) {
      return new Response(null, { status: 301, headers: { Location: `https://${customDomain}/${cleanSlug}` } })
    }
  }

  // ── User-managed 301 redirects (SEO Optimizer → Strumenti) ──
  // Checked BEFORE the page lookup so old/removed URLs (e.g. /login moved to the
  // app subdomain) send a clean 301 instead of a 404.
  if (config?.redirects?.length) {
    const reqPath = pageSlug === 'home' ? '/' : `/${pageSlug}`
    const norm = (s: string) => '/' + s.trim().replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+|\/+$/g, '')
    const hit = config.redirects.find(r => r.from && norm(r.from) === norm(reqPath))
    if (hit && hit.to) {
      const target = /^https?:\/\//i.test(hit.to) ? hit.to : `https://${customDomain}${hit.to.startsWith('/') ? '' : '/'}${hit.to}`
      return new Response(null, { status: 301, headers: { Location: target } })
    }
  }

  if (!config?.published_pages || config.published_pages.length === 0) {
    return errorPage(200, projectName, 'Il sito non è ancora stato pubblicato.')
  }

  const page = config.published_pages.find(p => p.slug === pageSlug)
  if (!page) return errorPage(404, '404', `La pagina "/${pageSlug}" non esiste.`)

  // Custom domain: base = https://{domain}/, siteUrl = https://{domain} (no trailing slash)
  const base = `https://${customDomain}/`
  const siteUrl = `https://${customDomain}`
  const knownSlugs = ['blog', ...(config.published_pages).map(p => p.slug)]
  const faviconUrl = config.favicon_url
  // OG image: page-specific → else the site-wide default (so no page lacks og:image)
  const ogImageUrl = page.og_image || (config as Record<string, unknown>)?.default_og_image as string | undefined
  const injectPoints = (config as Record<string, unknown>)?.inject_points as InjectPoints | undefined
  const sharedCss = config.shared_css
  const sharedNav = config.shared_nav_html
  const sharedFooter = config.shared_footer_html

  const siteName = (config?.context?.businessName as string | undefined) ?? projectName ?? ''
  return new Response(prepareHtml(page.html, base, siteUrl, false, knownSlugs, faviconUrl, ogImageUrl, injectPoints, sharedCss, sharedNav, sharedFooter, pageSlug, page.robots, page.og_title, siteName), {
    status: 200,
    // Cache published pages on CDN for 5 min (s-maxage) — drastically reduces Supabase egress.
    // Browser revalidates every time (no-cache) so users always get fresh content,
    // but Vercel CDN serves from cache without hitting Supabase on every request.
    // After Publish, stale CDN responses expire within 5 minutes (acceptable for a website builder).
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' },
  })
}
