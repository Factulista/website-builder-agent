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
  return {
    checkId: 'canonical', score: has ? 100 : 0,
    status: has ? 'pass' : 'fail',
    detail: has ? `canonical: ${url || '(presente)'}` : 'Tag canonical mancante',
    data: { has, url },
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

function checkOpenGraph(html: string): CheckResult {
  const tags = ['og:title', 'og:description', 'og:image', 'og:url']
  const present = tags.filter(tag =>
    new RegExp(`<meta\\b[^>]*property=["']${tag}["'][^>]*content=["'][^"']+["']`, 'i').test(html)
    || new RegExp(`<meta\\b[^>]*content=["'][^"']+["'][^>]*property=["']${tag}["']`, 'i').test(html)
  )
  const score = Math.round((present.length / tags.length) * 100)
  const missing = tags.filter(t => !present.includes(t))
  return {
    checkId: 'open-graph', score, status: statusFromScore(score),
    detail: present.length === 4
      ? 'Tutti i tag og:* presenti ✓'
      : `Mancanti: ${missing.join(', ')}`,
    data: { present, missing },
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

function checkHeadingHierarchy(html: string): CheckResult {
  const headings = [...html.matchAll(/<(h[1-6])\b[^>]*>/gi)].map(m => parseInt(m[1][1]))
  if (headings.length === 0) return { checkId: 'heading-hierarchy', score: 50, status: 'warn', detail: 'Nessun heading trovato', data: { issues: [] } }
  const issues: string[] = []
  for (let i = 1; i < headings.length; i++) {
    if (headings[i] > headings[i - 1] + 1) {
      issues.push(`H${headings[i - 1]}→H${headings[i]} (salto di livello)`)
    }
  }
  const score = issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 25)
  return {
    checkId: 'heading-hierarchy', score, status: statusFromScore(score),
    detail: issues.length === 0
      ? `Gerarchia corretta: ${headings.map(h => `H${h}`).join('→')} ✓`
      : `Problemi: ${issues.slice(0, 2).join(', ')}`,
    data: { headings, issues },
  }
}

function checkSemanticHtml(html: string): CheckResult {
  const tags = ['<header', '<nav', '<main', '<footer', '<article']
  const tagLabels = ['header', 'nav', 'main', 'footer', 'article']
  const present = tags.filter((t, i) => new RegExp(t, 'i').test(html)).map((_, i) => tagLabels[i])
  // main and footer are the most important — they get double weight
  const weights = { header: 1, nav: 1, main: 2, footer: 2, article: 1 }
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0)
  const earnedWeight = present.reduce((acc, t) => acc + (weights[t as keyof typeof weights] ?? 1), 0)
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

// ── Main analyzer ──────────────────────────────────────────────────────────────

const ANALYZERS: Record<CheckId, (html: string) => CheckResult> = {
  'title': checkTitle,
  'meta-description': checkMetaDescription,
  'canonical': checkCanonical,
  'lang': checkLang,
  'open-graph': checkOpenGraph,
  'h1-unique': checkH1Unique,
  'h1-keyword': checkH1Keyword,
  'heading-hierarchy': checkHeadingHierarchy,
  'semantic-html': checkSemanticHtml,
  'alt-text': checkAltText,
  'img-dimensions': checkImgDimensions,
  'lazy-loading': checkLazyLoading,
  'font-preconnect': checkFontPreconnect,
  'schema-organization': checkSchemaOrganization,
  'schema-faq': checkSchemaFaq,
}

export function analyzePage(pageSlug: string, pageName: string, html: string): PageAnalysis {
  const results: CheckResult[] = SEO_CHECKS.map(check => ANALYZERS[check.id](html))

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
  return pages.map(p => analyzePage(p.slug, p.name, p.html))
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
