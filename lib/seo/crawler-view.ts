/**
 * SEO meta injection — the SINGLE SOURCE OF TRUTH for how a page's <head> looks
 * to a crawler (Google, LLM bots) AFTER server-side injection.
 *
 * Used in two places so they can never drift:
 *   1. lib/preview.ts prepareHtml() — at serve time (what the crawler actually gets)
 *   2. the SEO analyzer — so the SEO panel evaluates the SAME final HTML, not the
 *      raw stored HTML. (Previously the analyzer saw raw HTML and wrongly reported
 *      "Schema FAQ 0/100", missing OG tags, etc. — even though the served page had them.)
 *
 * Injects: canonical, complete Open Graph set, Organization JSON-LD, FAQPage JSON-LD
 * (extracted from visible FAQ), robots meta, favicon.
 */

export type SoftwareOffer = { name?: string; price: string; priceCurrency?: string }
export type SoftwareInfo = {
  name?: string
  applicationCategory?: string   // e.g. BusinessApplication, FinanceApplication
  operatingSystem?: string       // e.g. Web
  description?: string
  offers?: SoftwareOffer[]        // pricing tiers
  aggregateRating?: { ratingValue: string | number; ratingCount: string | number }
}

export type SeoMetaContext = {
  siteUrl: string                 // canonical root, no trailing slash, e.g. https://www.factulista.com
  pageSlug: string                // 'home' or 'funcionalidades' etc.
  faviconUrl?: string
  siteName?: string
  ogTitle?: string                // per-page OG title override
  ogImageUrl?: string
  robots?: { noindex?: boolean; nofollow?: boolean }
  software?: SoftwareInfo         // if set, inject SoftwareApplication JSON-LD (SaaS sites)
}

/**
 * Extracts FAQ Q&A pairs from visible HTML → clean FAQPage JSON-LD, or null.
 * Supports .faq-trigger/.faq-content (accordion) and <details>/<summary>.
 */
export function extractFaqSchema(html: string, siteUrl: string): string | null {
  const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  const pairs: { q: string; a: string }[] = []

  const triggerRe = /<[^>]+class="[^"]*faq-trigger[^"]*"[^>]*>([\s\S]*?)<\/button>/gi
  const contentRe = /<[^>]+class="[^"]*faq-content[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
  const triggers: string[] = []
  const contents: string[] = []
  let m: RegExpExecArray | null
  while ((m = triggerRe.exec(html)) !== null) { const q = stripTags(m[1]); if (q) triggers.push(q) }
  while ((m = contentRe.exec(html)) !== null) { const a = stripTags(m[1]); if (a) contents.push(a) }
  if (triggers.length > 0 && contents.length > 0) {
    const count = Math.min(triggers.length, contents.length)
    for (let i = 0; i < count; i++) if (triggers[i] && contents[i]) pairs.push({ q: triggers[i], a: contents[i] })
  }

  if (pairs.length === 0) {
    const detailsRe = /<details[^>]*>([\s\S]*?)<\/details>/gi
    while ((m = detailsRe.exec(html)) !== null) {
      const inner = m[1]
      const summaryMatch = inner.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)
      if (!summaryMatch) continue
      const q = stripTags(summaryMatch[1])
      const a = stripTags(inner.replace(/<summary[^>]*>[\s\S]*?<\/summary>/i, ''))
      if (q && a) pairs.push({ q, a })
    }
  }

  if (pairs.length === 0) return null

  const esc = (s: string) => s.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const entities = pairs.map((p, i) => `{
      "@type": "Question",
      "@id": "${siteUrl}/#faq-${i + 1}",
      "name": "${esc(p.q)}",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "${esc(p.a)}"
      }
    }`).join(',\n    ')

  return `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    ${entities}
  ]
}
</script>`
}

/**
 * Applies all SEO-relevant <head> injections to an HTML string and returns the
 * result — exactly the <head> a crawler sees in production.
 */
export function applySeoMeta(html: string, ctx: SeoMetaContext): string {
  const { siteUrl, pageSlug, faviconUrl, siteName, ogTitle, ogImageUrl, robots, software } = ctx
  let result = html

  const canonicalUrl = (!pageSlug || pageSlug === 'home') ? `${siteUrl}/` : `${siteUrl}/${pageSlug}`

  // ── Canonical ──
  result = result.replace(/<link[^>]+rel=["']canonical["'][^>]*\/?>\s*/gi, '')
  if (/<head[^>]*>/i.test(result)) {
    result = result.replace(/<head[^>]*>/i, (m) => `${m}\n<link rel="canonical" href="${canonicalUrl}">`)
  }

  // ── Open Graph: complete, deduplicated ──
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

  // ── Organization JSON-LD ──
  result = result.replace(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?"@type"\s*:\s*"Organization"[\s\S]*?<\/script>\s*/gi, '')
  if (/<\/head>/i.test(result) && siteName) {
    const orgName = siteName.replace(/"/g, '&quot;')
    const orgDesc = (result.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? '').replace(/"/g, '&quot;')
    const orgLogo = faviconUrl ?? ''
    const orgSchema = `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "${orgName}",
  "url": "${siteUrl}",
  ${orgLogo ? `"logo": "${orgLogo}",` : ''}
  ${orgDesc ? `"description": "${orgDesc}",` : ''}
  "contactPoint": {
    "@type": "ContactPoint",
    "contactType": "Customer Support",
    "availableLanguage": "es"
  }
}
</script>`
    result = result.replace(/<\/head>/i, `${orgSchema}\n</head>`)
  }

  // ── SoftwareApplication JSON-LD (SaaS sites — from site config) ──
  // Strip any existing, then inject from the configured product info. Gives Google
  // rich results (price/rating) and tells LLMs "this is a software product with pricing".
  result = result.replace(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?"@type"\s*:\s*"SoftwareApplication"[\s\S]*?<\/script>\s*/gi, '')
  if (software && /<\/head>/i.test(result)) {
    const sEsc = (s: string) => String(s).replace(/"/g, '&quot;')
    const offers = (software.offers ?? []).map(o => `{
      "@type": "Offer",
      ${o.name ? `"name": "${sEsc(o.name)}",` : ''}
      "price": "${sEsc(o.price)}",
      "priceCurrency": "${sEsc(o.priceCurrency || 'EUR')}"
    }`).join(',\n    ')
    const rating = software.aggregateRating ? `,
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "${sEsc(String(software.aggregateRating.ratingValue))}",
    "ratingCount": "${sEsc(String(software.aggregateRating.ratingCount))}"
  }` : ''
    const swSchema = `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "${sEsc(software.name || siteName || '')}",
  "applicationCategory": "${sEsc(software.applicationCategory || 'BusinessApplication')}",
  "operatingSystem": "${sEsc(software.operatingSystem || 'Web')}",
  "url": "${siteUrl}"${software.description ? `,
  "description": "${sEsc(software.description)}"` : ''}${offers ? `,
  "offers": [
    ${offers}
  ]` : ''}${rating}
}
</script>`
    result = result.replace(/<\/head>/i, `${swSchema}\n</head>`)
  }

  // ── FAQPage JSON-LD (from visible FAQ) ──
  result = result.replace(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?"@type"\s*:\s*"FAQPage"[\s\S]*?<\/script>\s*/gi, '')
  const faqSchema = extractFaqSchema(result, siteUrl)
  if (faqSchema && /<\/head>/i.test(result)) {
    result = result.replace(/<\/head>/i, `${faqSchema}\n</head>`)
  }

  // ── Robots meta ──
  result = result.replace(/<meta[^>]+name=["']robots["'][^>]*\/?>\s*/gi, '')
  if (robots?.noindex || robots?.nofollow) {
    const idx = robots?.noindex ? 'noindex' : 'index'
    const flw = robots?.nofollow ? 'nofollow' : 'follow'
    const robotsTag = `<meta name="robots" content="${idx}, ${flw}">`
    if (/<head[^>]*>/i.test(result)) {
      result = result.replace(/<head[^>]*>/i, (m) => `${m}\n${robotsTag}`)
    }
  }

  // ── Favicon ──
  if (/<head[^>]*>/i.test(result) && faviconUrl) {
    result = result.replace(/<link[^>]+rel=["'](?:shortcut icon|icon|apple-touch-icon)["'][^>]*\/?>/gi, '')
    const ext = faviconUrl.split('?')[0].split('.').pop()?.toLowerCase() ?? 'png'
    const mimeMap: Record<string, string> = { ico: 'image/x-icon', svg: 'image/svg+xml', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' }
    const type = mimeMap[ext] ?? 'image/png'
    result = result.replace(/<head[^>]*>/i, (m) => `${m}\n<link rel="icon" type="${type}" href="${faviconUrl}">\n<link rel="apple-touch-icon" href="${faviconUrl}">`)
  }

  return result
}
