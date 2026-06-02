// ── SEO Analyzer — pure client-side, zero API calls ───────────────────────────
// Parses HTML strings with regex to produce a score (0–100) for each of the
// 15 SEO checks. Intentionally dependency-free so it can run in the browser.

import { SEO_CHECKS, type CheckId } from './checks'

export type CheckResult = {
  checkId: CheckId
  score: number       // 0–100
  status: 'pass' | 'warn' | 'fail'
  detail: string      // human-readable explanation shown in the UI
  /** Extra structured data used by prompt-builder to craft targeted fix prompts */
  data?: Record<string, unknown>
}

export type PageAnalysis = {
  pageSlug: string
  pageName: string
  results: CheckResult[]
  overallScore: number  // weighted average 0–100
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function statusFromScore(score: number): 'pass' | 'warn' | 'fail' {
  if (score >= 80) return 'pass'
  if (score >= 40) return 'warn'
  return 'fail'
}

function countImgTags(html: string): RegExpMatchArray[] {
  return [...html.matchAll(/<img\b([^>]*?)>/gi)]
}

function extractJsonLd(html: string): unknown[] {
  const results: unknown[] = []
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try { results.push(JSON.parse(m[1])) } catch { /* skip malformed */ }
  }
  return results
}

function jsonLdHasType(schemas: unknown[], ...types: string[]): boolean {
  const lowerTypes = types.map(t => t.toLowerCase())
  for (const s of schemas) {
    const type = (s as Record<string, unknown>)['@type']
    if (!type) continue
    const typeStr = Array.isArray(type) ? type.join(' ') : String(type)
    if (lowerTypes.some(t => typeStr.toLowerCase().includes(t))) return true
  }
  return false
}

// ── Individual check functions ─────────────────────────────────────────────────

function checkTitle(html: string): CheckResult {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!m) return { checkId: 'title', score: 0, status: 'fail', detail: 'Title tag mancante', data: { missing: true } }
  const text = m[1].trim()
  if (!text) return { checkId: 'title', score: 0, status: 'fail', detail: 'Title tag vuoto', data: { current: '' } }
  const len = text.length
  let score: number
  if (len >= 50 && len <= 60) score = 100
  else if (len >= 40 && len <= 70) score = 75
  else if (len >= 30) score = 50
  else score = 25
  return {
    checkId: 'title', score, status: statusFromScore(score),
    detail: len >= 50 && len <= 60
      ? `${len} chars — ottimale ✓`
      : `${len} chars — ideale 50–60 chars`,
    data: { current: text, length: len },
  }
}

function checkMetaDescription(html: string): CheckResult {
  const m = html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)
    ?? html.match(/<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i)
  if (!m) return { checkId: 'meta-description', score: 0, status: 'fail', detail: 'Meta description mancante', data: { missing: true } }
  const text = m[1].trim()
  if (!text) return { checkId: 'meta-description', score: 0, status: 'fail', detail: 'Meta description vuota', data: { current: '' } }
  const len = text.length
  let score: number
  if (len >= 150 && len <= 160) score = 100
  else if (len >= 120 && len <= 170) score = 75
  else if (len >= 80) score = 50
  else score = 25
  return {
    checkId: 'meta-description', score, status: statusFromScore(score),
    detail: len >= 150 && len <= 160
      ? `${len} chars — ottimale ✓`
      : `${len} chars — ideale 150–160 chars`,
    data: { current: text, length: len },
  }
}

function checkCanonical(html: string): CheckResult {
  const has = /<link\b[^>]*rel=["']canonical["'][^>]*>/i.test(html)
  const url = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i)?.[1] ?? ''
  // A canonical tag is only valid if it has an absolute URL (http/https)
  const isValid = has && /^https?:\/\//i.test(url)
  const score = isValid ? 100 : 0
  const status: CheckResult['status'] = isValid ? 'pass' : 'fail'
  let detail: string
  if (!has) detail = 'Tag canonical mancante'
  else if (!isValid) detail = `canonical non valido: "${url}" (deve essere URL assoluto)`
  else detail = `canonical: ${url}`
  return {
    checkId: 'canonical', score, status,
    detail,
    data: { has, url, isValid },
  }
}

function checkLang(html: string): CheckResult {
  const m = html.match(/<html\b[^>]*lang=["']([^"']*)["']/i)
  const lang = m?.[1] ?? ''
  return {
    checkId: 'lang', score: lang ? 100 : 0,
    status: lang ? 'pass' : 'fail',
    detail: lang ? `lang="${lang}" ✓` : 'Attributo lang mancante su <html>',
    data: { lang },
  }
}

function checkNoindex(html: string): CheckResult {
  // Detect <meta name="robots" content="...noindex...">
  const metaMatch = html.match(/<meta\b[^>]*name=["']robots["'][^>]*content=["']([^"']*)["']/i)
                 ?? html.match(/<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']robots["']/i)
  const metaContent = metaMatch?.[1] ?? ''
  const hasNoindexMeta = /\bnoindex\b/i.test(metaContent)

  // Detect <meta name="googlebot" content="...noindex...">
  const googlebotMatch = html.match(/<meta\b[^>]*name=["']googlebot["'][^>]*content=["']([^"']*)["']/i)
                      ?? html.match(/<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']googlebot["']/i)
  const googlebotContent = googlebotMatch?.[1] ?? ''
  const hasNoindexGooglebot = /\bnoindex\b/i.test(googlebotContent)

  const hasNoindex = hasNoindexMeta || hasNoindexGooglebot
  const source = hasNoindexMeta ? 'robots' : hasNoindexGooglebot ? 'googlebot' : ''

  return {
    checkId: 'noindex',
    score: hasNoindex ? 0 : 100,
    status: hasNoindex ? 'fail' : 'pass',
    detail: hasNoindex
      ? `Meta tag noindex rilevato (name="${source}") — la pagina non verrà indicizzata`
      : 'Nessun noindex rilevato ✓',
    data: { hasNoindex, source },
  }
}

/** URLs that are considered placeholder/fake og:images and should be flagged as missing. */
const OG_IMAGE_PLACEHOLDERS = [
  'placehold.co', 'placeholder.com', 'picsum.photos', 'via.placeholder.com',
  'dummyimage.com', 'lorempixel.com', 'fakeimg.pl',
]

function getOgTagContent(html: string, property: string): string | null {
  const m =
    html.match(new RegExp(`<meta\\b[^>]*property=["']${property}["'][^>]*content=["']([^"']+)["']`, 'i'))
    ?? html.match(new RegExp(`<meta\\b[^>]*content=["']([^"']+)["'][^>]*property=["']${property}["']`, 'i'))
  return m?.[1] ?? null
}

function checkOpenGraph(html: string): CheckResult {
  const tags = ['og:title', 'og:description', 'og:image', 'og:url']

  const present: string[] = []
  const placeholderImage: string[] = []

  for (const tag of tags) {
    const content = getOgTagContent(html, tag)
    if (!content) continue
    if (tag === 'og:image' && OG_IMAGE_PLACEHOLDERS.some(p => content.includes(p))) {
      // Image exists but is a placeholder — flag separately, don't count as present
      placeholderImage.push(content)
      continue
    }
    present.push(tag)
  }

  const missing = tags.filter(t => !present.includes(t))
  const score = Math.round((present.length / tags.length) * 100)

  const isPlaceholderImg = placeholderImage.length > 0
  const detail = present.length === 4
    ? 'Tutti i tag og:* presenti ✓'
    : isPlaceholderImg && missing.includes('og:image')
      ? `og:image usa un placeholder — carica un'immagine reale. Mancanti: ${missing.filter(t => t !== 'og:image').join(', ') || 'nessuno'}`
      : `Mancanti: ${missing.join(', ')}`

  return {
    checkId: 'open-graph', score, status: statusFromScore(score),
    detail,
    data: { present, missing, placeholderImage },
  }
}

function checkH1Unique(html: string): CheckResult {
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)]
  const count = h1s.length
  const texts = h1s.map(m => m[1].replace(/<[^>]+>/g, '').trim())
  if (count === 1) return { checkId: 'h1-unique', score: 100, status: 'pass', detail: `H1 trovato: "${texts[0].slice(0, 60)}"`, data: { count, texts } }
  if (count === 0) return { checkId: 'h1-unique', score: 0, status: 'fail', detail: 'Nessun H1 trovato', data: { count } }
  return { checkId: 'h1-unique', score: 0, status: 'fail', detail: `${count} H1 trovati — deve essere esattamente 1`, data: { count, texts } }
}

function checkH1Keyword(html: string): CheckResult {
  const m = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
  if (!m) return { checkId: 'h1-keyword', score: 0, status: 'fail', detail: 'Nessun H1', data: { missing: true } }
  const text = m[1].replace(/<[^>]+>/g, '').trim()
  const words = text.split(/\s+/).filter(Boolean)
  // Heuristic: a meaningful H1 has 3+ words and 15+ chars (not a placeholder)
  const placeholders = ['hero', 'titolo', 'title', 'heading', 'lorem']
  const isPlaceholder = placeholders.some(p => text.toLowerCase().includes(p))
  let score: number
  if (isPlaceholder) score = 20
  else if (words.length >= 4 && text.length >= 20) score = 100
  else if (words.length >= 2 && text.length >= 10) score = 70
  else score = 40
  return {
    checkId: 'h1-keyword', score, status: statusFromScore(score),
    detail: score === 100 ? `"${text.slice(0, 60)}" ✓` : `H1 troppo generico: "${text.slice(0, 60)}"`,
    data: { text, wordCount: words.length },
  }
}

const MAX_HEADING_DEPTH = 3

function checkHeadingHierarchy(html: string): CheckResult {
  const headings = [...html.matchAll(/<(h[1-6])\b[^>]*>/gi)].map(m => parseInt(m[1][1]))
  if (headings.length === 0) return { checkId: 'heading-hierarchy', score: 50, status: 'warn', detail: 'Nessun heading trovato', data: { issues: [] } }
  const issues: string[] = []

  // Check 1: level skips going downward (e.g. H2→H4)
  for (let i = 1; i < headings.length; i++) {
    if (headings[i] > headings[i - 1] + 1) {
      issues.push(`H${headings[i - 1]}→H${headings[i]} (salto di livello)`)
    }
  }

  // Check 2: excessive depth (any heading deeper than MAX_HEADING_DEPTH)
  const deepHeadings = [...new Set(headings.filter(h => h > MAX_HEADING_DEPTH))].sort()
  if (deepHeadings.length > 0) {
    issues.push(`${deepHeadings.map(h => `H${h}`).join(', ')} troppo profondi (max H${MAX_HEADING_DEPTH})`)
  }

  const score = issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 25)
  return {
    checkId: 'heading-hierarchy', score, status: statusFromScore(score),
    detail: issues.length === 0
      ? `Gerarchia corretta (max H${MAX_HEADING_DEPTH}) ✓`
      : `Problemi: ${issues.slice(0, 2).join(', ')}`,
    data: { headings, issues },
  }
}

function checkSemanticHtml(html: string): CheckResult {
  // <article> is excluded: it's meaningful only for blog/news pages, not landing pages.
  // Its absence on a landing page is not an SEO issue.
  const tagLabels = ['header', 'nav', 'main', 'footer'] as const
  const weights: Record<string, number> = { header: 1, nav: 1, main: 3, footer: 2 }
  const present = tagLabels.filter(t => new RegExp(`<${t}\\b`, 'i').test(html))
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0)
  const earnedWeight = present.reduce((acc, t) => acc + (weights[t] ?? 1), 0)
  const score = Math.round((earnedWeight / totalWeight) * 100)
  const missing = tagLabels.filter(t => !present.includes(t))
  return {
    checkId: 'semantic-html', score, status: statusFromScore(score),
    detail: score === 100 ? 'Tutti i tag semantici presenti ✓' : `Mancanti: <${missing.join('>, <')}>`,
    data: { present, missing },
  }
}

function checkAltText(html: string): CheckResult {
  const imgs = countImgTags(html)
  if (imgs.length === 0) return { checkId: 'alt-text', score: 100, status: 'pass', detail: 'Nessuna immagine presente', data: { total: 0, withAlt: 0 } }
  const withAlt = imgs.filter(m => /\balt=["'][^"']+["']/i.test(m[1])).length
  const score = Math.round((withAlt / imgs.length) * 100)
  const missing = imgs.length - withAlt
  return {
    checkId: 'alt-text', score, status: statusFromScore(score),
    detail: missing === 0
      ? `Alt text su tutte le ${imgs.length} immagini ✓`
      : `${missing} immagine${missing > 1 ? 'i' : ''} senza alt text`,
    data: { total: imgs.length, withAlt, missing },
  }
}

function checkImgDimensions(html: string): CheckResult {
  const imgs = countImgTags(html)
  if (imgs.length === 0) return { checkId: 'img-dimensions', score: 100, status: 'pass', detail: 'Nessuna immagine presente', data: { total: 0 } }
  const withDims = imgs.filter(m => /\bwidth=["']/i.test(m[1]) && /\bheight=["']/i.test(m[1])).length
  const score = Math.round((withDims / imgs.length) * 100)
  const missing = imgs.length - withDims
  return {
    checkId: 'img-dimensions', score, status: statusFromScore(score),
    detail: missing === 0
      ? 'Width/height presenti su tutte le immagini ✓'
      : `${missing} immagine${missing > 1 ? 'i' : ''} senza width/height`,
    data: { total: imgs.length, withDims, missing },
  }
}

function checkLazyLoading(html: string): CheckResult {
  const imgs = countImgTags(html)
  // Skip hero/first image (should NOT be lazy) — count from index 1
  const lazyable = imgs.slice(1)
  if (lazyable.length === 0) return { checkId: 'lazy-loading', score: 100, status: 'pass', detail: 'Nessuna immagine lazy-loadable', data: { total: 0 } }
  const withLazy = lazyable.filter(m => /\bloading=["']lazy["']/i.test(m[1])).length
  const score = Math.round((withLazy / lazyable.length) * 100)
  const missing = lazyable.length - withLazy
  return {
    checkId: 'lazy-loading', score, status: statusFromScore(score),
    detail: missing === 0
      ? `loading="lazy" su tutte le ${lazyable.length} immagini ✓`
      : `${missing} immagine${missing > 1 ? 'i' : ''} senza lazy loading`,
    data: { total: lazyable.length, withLazy, missing },
  }
}

function checkFontPreconnect(html: string): CheckResult {
  const has = /<link\b[^>]*rel=["']preconnect["'][^>]*fonts\.googleapis\.com/i.test(html)
    || /<link\b[^>]*fonts\.googleapis\.com[^>]*rel=["']preconnect["']/i.test(html)
  return {
    checkId: 'font-preconnect', score: has ? 100 : 0,
    status: has ? 'pass' : 'fail',
    detail: has ? 'Preconnect Google Fonts presente ✓' : '<link rel="preconnect"> mancante',
    data: { has },
  }
}

function checkSchemaOrganization(html: string): CheckResult {
  const schemas = extractJsonLd(html)
  const has = jsonLdHasType(schemas, 'Organization', 'LocalBusiness', 'Corporation', 'NGO', 'Store')
  return {
    checkId: 'schema-organization', score: has ? 100 : 0,
    status: has ? 'pass' : 'fail',
    detail: has ? 'Schema Organization/LocalBusiness presente ✓' : 'JSON-LD Organization mancante',
    data: { has, schemasFound: schemas.length },
  }
}

function checkSchemaFaq(html: string): CheckResult {
  // Check if there is a FAQ section first (if no FAQ section → check is N/A → score 100)
  const hasFaqSection = /\b(faq|domande\s+frequent|frequently\s+asked|preguntas?\s+frecuentes?)\b/i.test(html)
  if (!hasFaqSection) {
    return {
      checkId: 'schema-faq', score: 100, status: 'pass',
      detail: 'Nessuna sezione FAQ rilevata (check N/A)',
      data: { hasFaqSection: false },
    }
  }
  const schemas = extractJsonLd(html)
  const has = jsonLdHasType(schemas, 'FAQPage')
  return {
    checkId: 'schema-faq', score: has ? 100 : 0,
    status: has ? 'pass' : 'fail',
    detail: has ? 'Schema FAQPage presente ✓' : 'Sezione FAQ rilevata ma schema JSON-LD mancante',
    data: { hasFaqSection: true, has },
  }
}

function checkBrokenLinks(html: string, allSlugs: Set<string>): CheckResult {
  const broken: string[] = []
  const re = /<a\b[^>]*href=["']([^"']*)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const href = m[1].trim()
    // Skip: external, anchor-only, mailto, tel, javascript, empty
    if (!href || /^(https?:|mailto:|tel:|javascript:|\/\/|#)/i.test(href)) continue
    // Normalize: remove leading slash, trailing slash, query, hash
    let path = href.replace(/^\//, '').replace(/\/$/, '').split('?')[0].split('#')[0]
    // "/" → home (always valid)
    if (path === '') continue
    // Skip blog paths (we'd need blog post slugs to verify)
    if (path.startsWith('blog')) continue
    // Check against known slugs
    if (!allSlugs.has(path)) broken.push(`/${path}`)
  }
  const unique = [...new Set(broken)]
  if (unique.length === 0) {
    return {
      checkId: 'broken-links', score: 100, status: 'pass',
      detail: 'Nessun link interno rotto ✓',
      data: { broken: [] },
    }
  }
  const preview = unique.slice(0, 3).join(', ') + (unique.length > 3 ? ` +${unique.length - 3}` : '')
  return {
    checkId: 'broken-links', score: 0, status: 'fail',
    detail: `${unique.length} link intern${unique.length > 1 ? 'i' : 'o'} rott${unique.length > 1 ? 'i' : 'o'}: ${preview}`,
    data: { broken: unique },
  }
}

function checkH1Coherence(html: string): CheckResult {
  const h1M = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (!h1M) return { checkId: 'h1-coherence', score: 0, status: 'fail', detail: 'Nessun H1 trovato', data: { missing: [] } }
  const h1 = h1M[1].replace(/<[^>]+>/g, '').replace(/&#?\w+;/g, ' ').toLowerCase()
  const stopWords = new Set(['el','la','lo','los','las','de','del','en','y','a','con','para','por','que','un','una','su','o','al','se','es','the','and','for','of','to','in','is','it','with','on','at','by','an','be','as','or','are'])
  const h1Words = h1.match(/\b[a-záéíóúüñàèìòùç]{4,}\b/gi)?.filter(w => !stopWords.has(w)) ?? []
  if (h1Words.length === 0) return { checkId: 'h1-coherence', score: 50, status: 'warn', detail: 'H1 senza keyword identificabili', data: { missing: [] } }
  const bodyText = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&#?\w+;/g, ' ').toLowerCase()
  const missing = h1Words.filter(w => !bodyText.includes(w))
  const ratio = (h1Words.length - missing.length) / h1Words.length
  let score: number
  if (ratio === 1) score = 100
  else if (ratio >= 0.75) score = 75
  else if (ratio >= 0.5) score = 50
  else score = 25
  if (missing.length === 0) return { checkId: 'h1-coherence', score: 100, status: 'pass', detail: 'Tutte le keyword H1 sono nel testo ✓', data: { missing: [] } }
  return { checkId: 'h1-coherence', score, status: statusFromScore(score), detail: `${missing.length} keyword H1 assent${missing.length > 1 ? 'i' : 'e'} nel testo: ${missing.slice(0,4).join(', ')}`, data: { missing, h1Words } }
}

function checkWordCount(html: string): CheckResult {
  const text = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const count = text.split(/\s+/).filter(w => w.length > 0).length
  let score: number
  if (count >= 300) score = 100
  else if (count >= 200) score = 75
  else if (count >= 100) score = 50
  else score = 25
  return { checkId: 'word-count', score, status: statusFromScore(score), detail: `${count} parole — minimo consigliato 300`, data: { count } }
}

function checkLinkTitleAttr(html: string): CheckResult {
  const allLinks = [...html.matchAll(/<a\b([^>]*)>/gi)]
  const total = allLinks.length
  if (total === 0) return { checkId: 'link-title-attr', score: 100, status: 'pass', detail: 'Nessun link nella pagina', data: { total: 0, missing: 0 } }
  const missing = allLinks.filter(m => !/\btitle=/i.test(m[1])).length
  const ratio = (total - missing) / total
  let score: number
  if (ratio >= 1) score = 100
  else if (ratio >= 0.75) score = 75
  else if (ratio >= 0.5) score = 50
  else score = 25
  if (missing === 0) return { checkId: 'link-title-attr', score: 100, status: 'pass', detail: 'Tutti i link hanno l\'attributo title ✓', data: { total, missing: 0 } }
  return { checkId: 'link-title-attr', score, status: statusFromScore(score), detail: `${missing}/${total} link senza attributo title`, data: { total, missing } }
}

function checkTextHtmlRatio(html: string): CheckResult {
  const htmlSize = html.length
  const text = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  const textSize = text.length
  const ratio = htmlSize > 0 ? Math.round((textSize / htmlSize) * 100) : 0
  const toKB = (n: number) => `${(n / 1024).toFixed(1)}KB`
  let score: number
  if (ratio >= 25) score = 100
  else if (ratio >= 15) score = 75
  else if (ratio >= 10) score = 50
  else score = 25
  return { checkId: 'text-html-ratio', score, status: statusFromScore(score), detail: `Ratio testo/HTML: ${ratio}% (testo: ${toKB(textSize)} / HTML: ${toKB(htmlSize)})`, data: { ratio, textSize, htmlSize } }
}

function checkIframeUsage(html: string): CheckResult {
  // Collect all iframes
  const allIframes = [...html.matchAll(/<iframe\b([^>]*)>/gi)].map(m => m[1])
  if (allIframes.length === 0) {
    return { checkId: 'iframe-usage', score: 100, status: 'pass', detail: 'Nessun iframe presente ✓', data: { total: 0, problematic: [] } }
  }

  // Safe iframe patterns: GTM noscript (0×0, hidden), YouTube/Vimeo embeds are borderline
  const isSafe = (attrs: string) => {
    const src = attrs.match(/src=["']([^"']*)/i)?.[1] ?? ''
    const style = attrs.match(/style=["']([^"']*)/i)?.[1] ?? ''
    const w = attrs.match(/width=["']?(\d+)/i)?.[1] ?? '100'
    const h = attrs.match(/height=["']?(\d+)/i)?.[1] ?? '100'
    // GTM noscript: 0x0, hidden, googletagmanager
    if (/googletagmanager\.com/i.test(src) && parseInt(w) === 0 && parseInt(h) === 0) return true
    // Explicitly hidden via style
    if (/display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style)) return true
    // 0x0 size
    if (parseInt(w) === 0 && parseInt(h) === 0) return true
    return false
  }

  // Check if inside <noscript>
  const noscriptContent = [...html.matchAll(/<noscript[^>]*>([\s\S]*?)<\/noscript>/gi)].map(m => m[1]).join('')
  const problematic = allIframes.filter(attrs => {
    if (isSafe(attrs)) return false
    const src = attrs.match(/src=["']([^"']*)/i)?.[1] ?? ''
    // Check if this src is inside a noscript
    if (src && noscriptContent.includes(src)) return false
    return true
  })

  if (problematic.length === 0) {
    return {
      checkId: 'iframe-usage', score: 100, status: 'pass',
      detail: `${allIframes.length} iframe present${allIframes.length > 1 ? 'i' : 'e'}, tutti nascosti/sicuri (GTM noscript) ✓`,
      data: { total: allIframes.length, problematic: [] },
    }
  }

  const score = problematic.length === 1 ? 50 : 25
  return {
    checkId: 'iframe-usage', score, status: 'warn',
    detail: `${problematic.length} iframe visibil${problematic.length > 1 ? 'i' : 'e'} con contenuto esterno — valuta se necessari`,
    data: { total: allIframes.length, problematic },
  }
}

function checkObsoleteTags(html: string): CheckResult {
  const OBSOLETE = ['strike','font','center','tt','big','basefont','applet','acronym','isindex','listing','plaintext','xmp','marquee','blink','spacer']
  const found: string[] = []
  for (const tag of OBSOLETE) {
    if (new RegExp(`<${tag}[\\s>]`, 'i').test(html)) found.push(`<${tag}>`)
  }
  if (found.length === 0) {
    return { checkId: 'obsolete-tags', score: 100, status: 'pass', detail: 'Nessun tag obsoleto trovato ✓', data: { found: [] } }
  }
  return {
    checkId: 'obsolete-tags', score: 0, status: 'fail',
    detail: `${found.length} tag obsolet${found.length > 1 ? 'i' : 'o'}: ${found.join(', ')}`,
    data: { found },
  }
}

function checkFavicon(html: string): CheckResult {
  const hasFavicon = /<link[^>]+(rel=["'](?:icon|shortcut icon)["'][^>]*|[^>]*rel=["'](?:icon|shortcut icon)["'])[^>]*>/i.test(html)
  if (hasFavicon) return { checkId: 'favicon', score: 100, status: 'pass', detail: 'Favicon configurata ✓', data: {} }
  return { checkId: 'favicon', score: 0, status: 'fail', detail: 'Favicon mancante — aggiungila dalla sezione Media', data: { missing: true } }
}

function checkViewport(html: string): CheckResult {
  const m = html.match(/<meta[^>]+name=["']viewport["'][^>]*content=["']([^"']*)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']viewport["']/i)
  if (!m) return { checkId: 'viewport', score: 0, status: 'fail', detail: 'Meta viewport mancante', data: { missing: true } }
  const content = m[1]
  const hasUserScalableNo = /user-scalable\s*=\s*no/i.test(content)
  const maxScale = content.match(/maximum-scale\s*=\s*([\d.]+)/i)?.[1]
  const badMaxScale = maxScale && parseFloat(maxScale) < 5
  if (hasUserScalableNo || badMaxScale) {
    return { checkId: 'viewport', score: 50, status: 'warn', detail: 'Viewport blocca lo zoom utente (user-scalable=no o maximum-scale<5)', data: { content } }
  }
  return { checkId: 'viewport', score: 100, status: 'pass', detail: 'Meta viewport ottimizzato ✓', data: { content } }
}

function checkDoctype(html: string): CheckResult {
  const hasDoctype = /^\s*<!doctype\s+html\s*>/i.test(html.trimStart())
  if (hasDoctype) return { checkId: 'doctype', score: 100, status: 'pass', detail: 'DOCTYPE HTML5 presente ✓', data: {} }
  return { checkId: 'doctype', score: 0, status: 'fail', detail: '<!DOCTYPE html> mancante o non in prima riga', data: { missing: true } }
}

function checkTitleKeywordCoherence(html: string): CheckResult {
  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!titleM) return { checkId: 'title-keyword-coherence', score: 0, status: 'fail', detail: 'Title tag mancante', data: { missing: true } }
  const title = titleM[1].replace(/&#?\w+;/g, ' ').toLowerCase()
  // Extract meaningful words from title (skip short stop-words)
  const stopWords = new Set(['el','la','lo','los','las','de','del','en','y','a','con','para','por','que','un','una','su','o','al','se','es','the','and','for','of','to','in','is','it','with','on','at','by','an','be','as','or','are'])
  const titleWords = title.match(/\b[a-záéíóúüñàèìòùç]{4,}\b/gi)?.filter(w => !stopWords.has(w)) ?? []
  if (titleWords.length === 0) return { checkId: 'title-keyword-coherence', score: 50, status: 'warn', detail: 'Title senza keyword identificabili', data: { missing: [] } }
  // Strip tags from body text
  const bodyText = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#?\w+;/g, ' ')
    .toLowerCase()
  const missing = titleWords.filter(w => !bodyText.includes(w))
  const presentCount = titleWords.length - missing.length
  const ratio = presentCount / titleWords.length
  let score: number
  if (ratio === 1) score = 100
  else if (ratio >= 0.75) score = 75
  else if (ratio >= 0.5) score = 50
  else score = 25
  if (missing.length === 0) {
    return { checkId: 'title-keyword-coherence', score: 100, status: 'pass', detail: 'Tutte le keyword del titolo sono nel testo ✓', data: { missing: [] } }
  }
  return {
    checkId: 'title-keyword-coherence', score, status: statusFromScore(score),
    detail: `${missing.length} keyword del titolo assent${missing.length > 1 ? 'i' : 'e'} nel testo: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ` +${missing.length - 4}` : ''}`,
    data: { missing, titleWords },
  }
}

// ── Main analyzer ──────────────────────────────────────────────────────────────

const ANALYZERS: Record<CheckId, (html: string) => CheckResult> = {
  'title': checkTitle,
  'meta-description': checkMetaDescription,
  'canonical': checkCanonical,
  'lang': checkLang,
  'noindex': checkNoindex,
  'open-graph': checkOpenGraph,
  'h1-unique': checkH1Unique,
  'h1-keyword': checkH1Keyword,
  'title-keyword-coherence': checkTitleKeywordCoherence,
  'heading-hierarchy': checkHeadingHierarchy,
  'semantic-html': checkSemanticHtml,
  'alt-text': checkAltText,
  'img-dimensions': checkImgDimensions,
  'lazy-loading': checkLazyLoading,
  'font-preconnect': checkFontPreconnect,
  'schema-organization': checkSchemaOrganization,
  'schema-faq': checkSchemaFaq,
  // broken-links needs allSlugs context — handled specially in analyzePage
  'broken-links': (html) => checkBrokenLinks(html, new Set()),
  'h1-coherence': checkH1Coherence,
  'word-count': checkWordCount,
  'link-title-attr': checkLinkTitleAttr,
  'text-html-ratio': checkTextHtmlRatio,
  'pagespeed': () => ({ checkId: 'pagespeed' as const, score: 50, status: 'warn' as const, detail: 'Clicca "Analizza velocità" per misurare FCP, LCP e TTI in tempo reale', data: {} }),
  'iframe-usage': checkIframeUsage,
  'obsolete-tags': checkObsoleteTags,
  'favicon': checkFavicon,
  'viewport': checkViewport,
  'doctype': checkDoctype,
}

export function analyzePage(pageSlug: string, pageName: string, html: string, allSlugs?: Set<string>): PageAnalysis {
  const slugs = allSlugs ?? new Set<string>()
  const results: CheckResult[] = SEO_CHECKS.map(check => {
    if (check.id === 'broken-links') return checkBrokenLinks(html, slugs)
    return ANALYZERS[check.id](html)
  })

  // Weighted overall score
  const totalWeight = SEO_CHECKS.reduce((acc, c) => acc + c.weight, 0)
  const overallScore = Math.round(
    results.reduce((acc, r) => {
      const check = SEO_CHECKS.find(c => c.id === r.checkId)!
      return acc + (r.score * check.weight) / totalWeight
    }, 0)
  )

  return { pageSlug, pageName, results, overallScore }
}

export function analyzeAllPages(pages: { slug: string; name: string; html: string }[]): PageAnalysis[] {
  // Build slug set from non-blog pages for broken-link detection
  const allSlugs = new Set(pages.map(p => p.slug).filter(s => !s.startsWith('blog/')))
  return pages.map(p => analyzePage(p.slug, p.name, p.html, allSlugs))
}

export function getAggregateScore(analyses: PageAnalysis[]): number {
  if (analyses.length === 0) return 0
  return Math.round(analyses.reduce((acc, a) => acc + a.overallScore, 0) / analyses.length)
}

export function scoreColor(score: number): string {
  if (score >= 80) return '#22c55e'  // green
  if (score >= 60) return '#84cc16'  // lime
  if (score >= 40) return '#f59e0b'  // amber
  return '#ef4444'                    // red
}
