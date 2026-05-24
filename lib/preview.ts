import { createClient } from '@supabase/supabase-js'

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
 * Prepares page HTML for serving:
 * 1. Normalises root-relative internal links (href="/blog" → href="./blog").
 * 2. Injects <base href> so all relative links (./blog, ./contact …) resolve correctly.
 * 3. Replaces every {{site_url}} placeholder with the absolute canonical root URL.
 * 4. In staging mode: strips <link rel="canonical"> and og:url (staging must NOT be
 *    indexed) and injects <meta name="robots" content="noindex, follow">.
 */
function prepareHtml(html: string, base: string, siteUrl: string, isStaging: boolean, knownSlugs: string[] = [], faviconUrl?: string, ogImageUrl?: string): string {
  const baseTag = `<base href="${base}">`

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
    if (faviconUrl && !/<link[^>]+rel=["']icon["']/i.test(result)) {
      result = result.replace(/<head[^>]*>/i, (m) => `${m}\n<link rel="icon" href="${faviconUrl}">`)
    }
    if (ogImageUrl && !/<meta[^>]+property=["']og:image["']/i.test(result)) {
      result = result.replace(/<head[^>]*>/i, (m) => `${m}\n<meta property="og:image" content="${ogImageUrl}">`)
    }
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

  // Staging: base = /preview/{slug}/, siteUrl = https://myweb.{ROOT_DOMAIN}/{slug}
  const base = `/preview/${projectSlug}/`
  const siteUrl = `https://myweb.${ROOT_DOMAIN}/${projectSlug}`
  const knownSlugs = ['blog', ...(config?.pages ?? []).map(p => p.slug)]
  const faviconUrl = config?.favicon_url
  const page = config?.pages?.find(p => p.slug === pageSlug)
  const ogImageUrl = page?.og_image

  return new Response(prepareHtml(pageHtml, base, siteUrl, true, knownSlugs, faviconUrl, ogImageUrl), {
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

  return new Response(prepareHtml(page.html, base, siteUrl, false, knownSlugs, faviconUrl, ogImageUrl), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60, s-maxage=300' },
  })
}
