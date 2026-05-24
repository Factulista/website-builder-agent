import { NextRequest } from 'next/server'
import { callClaude } from '../../../lib/agents/config'
import { SEO_KNOWLEDGE } from '../../../lib/agents/knowledge/seo'
import { buildContextPrompt, type ProjectContext } from '../../../lib/agents/memory-agent'
import { getCheck } from '../../../lib/seo/checks'
import type { CheckId } from '../../../lib/seo/checks'
import type { CheckResult } from '../../../lib/seo/analyzer'
import { requireUserAndProject, ApiError } from '../../../lib/api-auth'
import { precheckCredits, consumeCredits, CreditsError } from '../../../lib/credits'

/** Shared per-request token counter, mutated by callSeoAgent. */
type TokenBag = { input: number; output: number }

export const runtime = 'nodejs'
export const maxDuration = 120

type Page = { slug: string; name: string; html: string }

function enc(msg: object, encoder: TextEncoder): Uint8Array {
  return encoder.encode(JSON.stringify(msg) + '\n')
}

// ── Direct HTML patcher — no LLM, no skeleton mismatch ───────────────────────
// Each check is applied deterministically with regex directly on the full HTML.
// SEO-owner checks receive the LLM-generated content as `generated`.

function applyHtmlFix(
  checkId: CheckId,
  html: string,
  generated: string,
  opts: { canonicalUrl: string; language: string; checkResult?: CheckResult }
): string {
  const { canonicalUrl, language, checkResult } = opts

  switch (checkId) {

    // ── HTML-owner: structural fixes (no LLM content needed) ─────────────────

    case 'canonical': {
      // Remove any existing canonical
      html = html.replace(/<link\b[^>]*rel=["']canonical["'][^>]*>\n?/gi, '')
      const tag = `<link rel="canonical" href="${canonicalUrl}">`
      if (/<\/title>/i.test(html))
        return html.replace(/<\/title>/i, `</title>\n  ${tag}`)
      return html.replace(/<\/head>/i, `  ${tag}\n</head>`)
    }

    case 'lang': {
      const lang = language || 'it'
      if (/<html\b[^>]*lang=/i.test(html))
        return html.replace(/(<html\b[^>]*)lang=["'][^"']*["']/i, `$1lang="${lang}"`)
      return html.replace(/<html\b/i, `<html lang="${lang}"`)
    }

    case 'img-dimensions': {
      return html.replace(/<img\b([^>]*)>/gi, (match, attrs) => {
        if (/\bwidth=/i.test(attrs) && /\bheight=/i.test(attrs)) return match
        const picsum = attrs.match(/src=["'][^"']*picsum\.photos\/(?:seed\/[^/]+\/)?(\d+)\/(\d+)["']/i)
        const w = picsum?.[1] ?? '100%'
        const h = picsum?.[2] ?? 'auto'
        return `<img${attrs} width="${w}" height="${h}">`
      })
    }

    case 'lazy-loading': {
      let firstImg = true
      return html.replace(/<img\b([^>]*)>/gi, (match, attrs) => {
        if (firstImg) { firstImg = false; return match }
        if (/\bloading=/i.test(attrs)) return match
        return `<img${attrs} loading="lazy">`
      })
    }

    case 'font-preconnect': {
      if (/fonts\.googleapis\.com/i.test(html)) return html
      const tags = `<link rel="preconnect" href="https://fonts.googleapis.com">\n  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`
      return html.replace(/<head[^>]*>/i, (m) => `${m}\n  ${tags}`)
    }

    case 'h1-unique': {
      const data = checkResult?.data as { count?: number } | undefined
      if (!data || data.count === 0) {
        // Missing H1 — insert one before first H2
        const h2Match = html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)
        if (h2Match) {
          return html.replace(h2Match[0], `<h1>${h2Match[1]}</h1>\n${h2Match[0]}`)
        }
        // Fallback: derive H1 from page <title> and insert after <body>/<main>/<header>
        const rawTitle = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
        const h1Text = rawTitle.split(/[|\-–—·]/)[0].trim() || 'Titolo principale'
        const h1Tag = `<h1>${h1Text}</h1>`
        if (/<main\b[^>]*>/i.test(html))
          return html.replace(/<main\b[^>]*>/i, (m) => `${m}\n${h1Tag}`)
        if (/<header\b[^>]*>/i.test(html))
          return html.replace(/<header\b[^>]*>/i, (m) => `${m}\n${h1Tag}`)
        return html.replace(/<body\b[^>]*>/i, (m) => `${m}\n${h1Tag}`)
      }
      // Multiple H1s — convert all but the first to H2
      let firstH1 = true
      return html.replace(/<(\/?)h1(\b[^>]*)>/gi, (_m, slash, rest) => {
        if (!slash && firstH1) { firstH1 = false; return `<h1${rest}>` }
        if (firstH1) return `<h1${rest}>` // closing tag before we saw an opener — keep
        return `<${slash}h2${rest}>`
      })
    }

    case 'heading-hierarchy': {
      // Pass 1: fix level skips (e.g. H2→H4 becomes H2→H3).
      // Pass 2: cap depth at H3 (H4/H5/H6 → H3).
      // Closing tags are kept in sync with their remapped openers.
      const MAX_DEPTH = 3
      let prevLevel = 0
      let lastOpenOriginal = 0
      let lastOpenRemapped = 0
      return html.replace(/<(\/?)h([1-6])(\b[^>]*)>/gi, (_m, slash, lvl, rest) => {
        const n = parseInt(lvl, 10)
        if (slash) {
          const remapped = n === lastOpenOriginal ? lastOpenRemapped : n
          return `</h${remapped}${rest}>`
        }
        // Fix level skip first, then cap at MAX_DEPTH
        const noSkip = prevLevel === 0 ? 1 : Math.min(n, prevLevel + 1)
        const expected = Math.min(noSkip, MAX_DEPTH)
        prevLevel = expected
        lastOpenOriginal = n
        lastOpenRemapped = expected
        return `<h${expected}${rest}>`
      })
    }

    case 'semantic-html': {
      const data = checkResult?.data as { missing?: string[] } | undefined
      const missing = data?.missing ?? []

      /**
       * Renames a block-level tag (div/section) to a semantic tag.
       * Finds the opening tag by class-name pattern, then walks nesting depth
       * to locate the matching closing tag and renames both.
       */
      function renameToSemantic(
        src: string,
        classPattern: RegExp,
        newTag: string,
      ): string {
        const openRe = new RegExp(`<(div|section)\\b([^>]*)>`, 'gi')
        let m
        while ((m = openRe.exec(src)) !== null) {
          if (!classPattern.test(m[2])) continue
          const origTag = m[1]
          const attrs = m[2]
          const start = m.index
          const afterOpen = start + m[0].length
          // Walk nesting depth to find matching closing tag
          let depth = 1
          let pos = afterOpen
          const closeRe = new RegExp(`<(\/?)${origTag}\\b`, 'gi')
          closeRe.lastIndex = pos
          let cm
          let closeIdx = -1
          while ((cm = closeRe.exec(src)) !== null) {
            if (cm[1]) { depth--; if (depth === 0) { closeIdx = cm.index; break } }
            else depth++
          }
          if (closeIdx < 0) continue
          const closeTagLen = `</${origTag}>`.length
          return (
            src.slice(0, start) +
            `<${newTag}${attrs}>` +
            src.slice(afterOpen, closeIdx) +
            `</${newTag}>` +
            src.slice(closeIdx + closeTagLen)
          )
        }
        return src
      }

      // Fix: <header> — wrap first <nav> if no <header> exists
      if (missing.includes('header') && !/<header\b/i.test(html)) {
        html = html.replace(/(<nav\b[^>]*>[\s\S]*?<\/nav>)/i, `<header>\n$1\n</header>`)
      }

      // Fix: <footer> — rename footer-class div/section to <footer>
      if (missing.includes('footer') && !/<footer\b/i.test(html)) {
        const renamed = renameToSemantic(html, /\bfooter\b/i, 'footer')
        if (renamed !== html) {
          html = renamed
        } else {
          // Fallback: wrap everything between last </section>/</div> group and </body>
          html = html.replace(/(<\/(?:section|div)>)(\s*<\/body>)/i, '$1\n</footer>$2')
            .replace(/(<(?:section|div)\b[^>]*>\s*)(?=[\s\S]*<\/footer>)/, (m) =>
              m.replace(/^<(section|div)/, '<footer'))
        }
      }

      // Fix: <main> — wrap content between nav/header end and footer/body end
      if (missing.includes('main') && !/<main\b/i.test(html)) {
        // Try wrapping between closing nav/header and opening footer
        const wrapped = html.replace(
          /(<\/(?:header|nav)>)([\s\S]*?)(<(?:footer|\/body)\b)/i,
          (_m, after, mid, before) => `${after}\n<main>${mid}</main>\n${before}`,
        )
        if (wrapped !== html) html = wrapped
      }

      // Fix: <article> — wrap content inside <main> (or first large section) with <article>
      if (missing.includes('article') && !/<article\b/i.test(html)) {
        if (/<main\b[^>]*>/i.test(html)) {
          html = html.replace(/(<main\b[^>]*>)([\s\S]*?)(<\/main>)/i,
            (_m, open, mid, close) => `${open}\n<article>${mid}</article>\n${close}`)
        }
      }

      return html
    }

    // ── SEO-owner: LLM generates content, we inject it deterministically ─────

    case 'title': {
      const safe = generated.replace(/</g, '&lt;').replace(/>/g, '&gt;')
      if (/<title[^>]*>/i.test(html))
        return html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${safe}</title>`)
      return html.replace(/<head[^>]*>/i, (m) => `${m}\n  <title>${safe}</title>`)
    }

    case 'meta-description': {
      const safe = generated.replace(/"/g, '&quot;')
      const tag = `<meta name="description" content="${safe}">`
      html = html.replace(/<meta\b[^>]*name=["']description["'][^>]*>\n?/gi, '')
      html = html.replace(/<meta\b[^>]*content=["'][^"']*["'][^>]*name=["']description["'][^>]*>\n?/gi, '')
      if (/<\/title>/i.test(html))
        return html.replace(/<\/title>/i, `</title>\n  ${tag}`)
      return html.replace(/<\/head>/i, `  ${tag}\n</head>`)
    }

    case 'h1-keyword': {
      // If there's no H1 at all, insert one before the first H2 (or after <body>)
      if (!/<h1\b/i.test(html)) {
        const h2Match = html.match(/<h2\b[^>]*>/)
        if (h2Match) {
          return html.replace(h2Match[0], `<h1>${generated}</h1>\n${h2Match[0]}`)
        }
        return html.replace(/<body\b[^>]*>/i, (m) => `${m}\n<h1>${generated}</h1>`)
      }
      return html.replace(/(<h1\b[^>]*>)[\s\S]*?(<\/h1>)/i, `$1${generated}$2`)
    }

    case 'open-graph': {
      // Remove any existing OG meta tags
      html = html.replace(/<meta\b[^>]*property=["']og:[^"']*["'][^>]*>\n?/gi, '')
      const tags = generated.trim()
      return html.replace(/<\/head>/i, `  ${tags}\n</head>`)
    }

    case 'alt-text': {
      try {
        const alts: Array<{ src_fragment: string; alt: string }> = JSON.parse(generated)
        for (const item of alts) {
          const escaped = item.src_fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          html = html.replace(
            new RegExp(`(<img\\b[^>]*${escaped}[^>]*?)(\\/?>)`, 'i'),
            (_m, before, close) => {
              if (/\balt=/i.test(before)) return _m
              return `${before} alt="${item.alt.replace(/"/g, '&quot;')}"${close}`
            }
          )
        }
      } catch { /* malformed JSON — return unchanged */ }
      return html
    }

    case 'schema-organization': {
      // Remove existing Organization/LocalBusiness schema
      html = html.replace(
        /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>\n?/gi,
        (m, body) => {
          try {
            const d = JSON.parse(body)
            const t = d['@type']
            if (typeof t === 'string' && /organization|localbusiness|corporation/i.test(t)) return ''
          } catch { /* keep */ }
          return m
        }
      )
      const jsonLd = `<script type="application/ld+json">\n${generated}\n</script>`
      return html.replace(/<\/head>/i, `  ${jsonLd}\n</head>`)
    }

    case 'schema-faq': {
      const jsonLd = `<script type="application/ld+json">\n${generated}\n</script>`
      return html.replace(/<\/head>/i, `  ${jsonLd}\n</head>`)
    }

    default:
      return html
  }
}

// ── Page context helpers ──────────────────────────────────────────────────────

function stripTags(s: string) { return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() }

/** Extracts SEO-relevant signals from raw HTML for use in prompts. */
function extractPageContext(html: string): string {
  const h1 = stripTags(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '')
  const h2s = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)]
    .slice(0, 4).map(m => stripTags(m[1])).filter(Boolean)
  const firstP = stripTags(html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '').slice(0, 200)
  const currentTitle = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')

  const lines = [
    currentTitle && `Title attuale: "${currentTitle}"`,
    h1 && `H1: "${h1}"`,
    h2s.length && `H2: ${h2s.map(h => `"${h}"`).join(', ')}`,
    firstP && `Primo paragrafo: "${firstP}"`,
  ].filter(Boolean)

  return lines.length ? `\nCONTENUTO PAGINA:\n${lines.join('\n')}` : ''
}

/**
 * Detects the site language from HTML, falling back to context, then 'it'.
 * Priority: <html lang="..."> attribute > context.language > 'it'
 */
function detectLanguage(html: string, contextLanguage?: string): string {
  const fromHtml = html.match(/<html\b[^>]*lang=["']([a-z]{2,5})["']/i)?.[1]
  return fromHtml || contextLanguage || 'it'
}

/**
 * Detects the brand name from page HTML when context.businessName is missing.
 * Tries: nav logo text → page title (first segment before separator) → H1
 */
function detectBrand(html: string, contextBrand?: string): string {
  if (contextBrand) return contextBrand

  // Nav logo element (most reliable)
  const navLogo = html.match(/<a\b[^>]*class="[^"]*(?:nav-logo|logo|brand)[^"]*"[^>]*>([\s\S]*?)<\/a>/i)?.[1]
  if (navLogo) {
    const text = stripTags(navLogo).trim()
    if (text && text.length < 50) return text
  }

  // Page title — first segment before separator (| — · -)
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
  if (title) {
    const seg = title.split(/[|\-–—·]/)[0].trim()
    if (seg && seg.length < 40) return seg
  }

  // H1 as last resort
  const h1 = stripTags(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '').slice(0, 40)
  return h1 || 'il sito'
}

// ── SEO content generator ─────────────────────────────────────────────────────

async function callSeoAgent(
  userPrompt: string,
  apiKey: string,
  context: ProjectContext,
  tokens?: TokenBag,
): Promise<string> {
  const system = `Sei un SEO copywriter esperto. Generi testi ottimizzati per i motori di ricerca.

${buildContextPrompt(context)}

REGOLA ASSOLUTA: rispondi con SOLO il testo richiesto — zero spiegazioni, zero markdown, zero tag HTML (salvo quando esplicitamente richiesto). Nessuna frase introduttiva, nessun commento finale.`

  const res = await callClaude('seo', system,
    [{ role: 'user', content: userPrompt }],
    [], apiKey)

  if (!res.ok) throw new Error(`SEO content API error: ${await res.text()}`)
  const data = await res.json()
  if (tokens && data.usage) {
    tokens.input += Number(data.usage.input_tokens ?? 0)
    tokens.output += Number(data.usage.output_tokens ?? 0)
  }
  const textBlock = data.content?.find((b: { type: string }) => b.type === 'text')
  return textBlock?.text?.trim() ?? ''
}

// Generates title with strict 50–60 char validation + up to 3 retries
async function generateTitle(
  pageName: string, html: string, brand: string, type: string, lang: string, apiKey: string, context: ProjectContext, tokens?: TokenBag
): Promise<string> {
  const pageCtx = extractPageContext(html)

  for (let attempt = 1; attempt <= 3; attempt++) {
    const prompt = attempt === 1
      ? `Scrivi il SEO title per la pagina "${pageName}" di un sito ${type} chiamato "${brand}".
${pageCtx}

REQUISITI OBBLIGATORI:
- Esattamente tra 50 e 60 caratteri (conta ogni lettera, spazio e simbolo)
- Contiene la keyword primaria della pagina (desumila da H1 e H2)
- Formato: "${brand} | [descrizione keyword della pagina]" — il brand appare UNA SOLA VOLTA
- Esempio con brand "Fatturify": "Fatturify | Fatturazione elettronica per PMI" (45 chars)
- Lingua: ${lang}

REGOLA CRITICA: il nome "${brand}" deve comparire ESATTAMENTE UNA VOLTA nel title.
CONTA I CARATTERI prima di rispondere. Rispondi SOLO con il testo del title, nient'altro.`
      : `Il title che hai scritto non rispetta i requisiti (range 50–60 caratteri e brand una sola volta).
Riscrivilo: formato "${brand} | [keyword descrittiva]", tra 50 e 60 caratteri, lingua ${lang}.
${pageCtx}
Contali uno per uno. Rispondi SOLO con il testo del title.`

    const result = await callSeoAgent(prompt, apiKey, context, tokens)
    const clean = result.replace(/^["']|["']$/g, '').trim()
    if (clean.length >= 50 && clean.length <= 60) return clean

    // Last attempt: force-fit
    if (attempt === 3) {
      if (clean.length > 60) return clean.slice(0, 57) + '...'
      // Too short — pad with keyword hint
      const padded = `${brand} | ${clean}`.slice(0, 60)
      return padded.length >= 50 ? padded : clean
    }
  }
  return ''
}

/** Truncates a meta description to ≤160 chars at the last sentence or word boundary. */
function truncateDescription(text: string, max = 160): string {
  if (text.length <= max) return text
  const sub = text.slice(0, max)
  // Try last sentence ending (. ! ?)
  const lastSentence = Math.max(sub.lastIndexOf('.'), sub.lastIndexOf('!'), sub.lastIndexOf('?'))
  if (lastSentence > max * 0.7) return sub.slice(0, lastSentence + 1).trim()
  // Fall back to last word boundary
  const lastSpace = sub.lastIndexOf(' ')
  return lastSpace > max * 0.7 ? sub.slice(0, lastSpace).trim() : sub.trim()
}

// Generates meta-description with strict 150–160 char validation + up to 3 retries
async function generateMetaDescription(
  pageName: string, html: string, brand: string, type: string, lang: string, apiKey: string, context: ProjectContext, tokens?: TokenBag
): Promise<string> {
  const pageCtx = extractPageContext(html)
  const cta = lang === 'es' ? 'Descúbrelo ahora.' : lang === 'en' ? 'Discover more today.' : 'Scopri di più ora.'

  for (let attempt = 1; attempt <= 3; attempt++) {
    const prompt = attempt === 1
      ? `Scrivi la meta description per la pagina "${pageName}" di un sito ${type} chiamato "${brand}".
${pageCtx}

REQUISITI OBBLIGATORI — rispettali alla lettera:
- Lunghezza: tra 150 e 160 caratteri INCLUSI (non 161, non 149)
- Include la keyword primaria della pagina
- Termina con un CTA come "${cta}"
- Lingua: ${lang}

TECNICA: scrivi la frase, poi contane i caratteri. Se sono più di 160, accorcia. Se meno di 150, aggiungi dettagli. Ripeti finché sei nel range.
Rispondi SOLO con il testo finale (niente spiegazioni).`
      : `La description che hai scritto ha ${
          // We'll embed the actual length in retry 2+
          'una lunghezza fuori dal range'
        } — deve essere tra 150 e 160 caratteri.
Riscrivila da zero per la pagina "${pageName}" (${type}, brand: "${brand}"), lingua ${lang}.
${pageCtx}
CTA finale obbligatorio: "${cta}"
Conta i caratteri uno per uno prima di rispondere. Rispondi SOLO con il testo.`

    const result = await callSeoAgent(prompt, apiKey, context, tokens)
    const clean = result.replace(/^["']|["']$/g, '').trim()
    if (clean.length >= 150 && clean.length <= 160) return clean

    // On last attempt: force-fit deterministically
    if (attempt === 3) {
      if (clean.length > 160) {
        // Truncate to last sentence/word and append CTA if needed
        const truncated = truncateDescription(clean, 160)
        if (truncated.length >= 150) return truncated
        // Truncated too much — add CTA to fill
        const withCta = truncated.endsWith('.') ? `${truncated} ${cta}` : `${truncated}. ${cta}`
        return truncateDescription(withCta, 160)
      }
      // Too short — append CTA until we reach 150+
      const withCta = clean.endsWith('.') ? `${clean} ${cta}` : `${clean}. ${cta}`
      if (withCta.length >= 150 && withCta.length <= 160) return withCta
      if (withCta.length > 160) return truncateDescription(withCta, 160)
      return withCta // accept slightly short rather than over-engineer
    }
  }
  return ''
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(c) { controller = c },
  })

  const emit = (step: string, time: string) => {
    controller?.enqueue(enc({ type: 'progress', step, time, tokens: 0 }, encoder))
  }
  const emitDone = (result: object) => {
    controller?.enqueue(enc({ type: 'done', result }, encoder))
    controller?.close()
  }
  const emitError = (error: string) => {
    controller?.enqueue(enc({ type: 'error', error }, encoder))
    controller?.close()
  }

  const startTime = Date.now()
  const elapsed = () => {
    const ms = Date.now() - startTime
    return ms >= 1000 ? `${Math.floor(ms / 1000)}s` : '0s'
  }

  ;(async () => {
    try {
      const { projectId, pageSlug, checkId, checkResult, pages, customDomain, projectMedia, blogPost } =
        await req.json() as {
          projectId: string
          pageSlug: string
          checkId: CheckId
          checkResult: CheckResult
          pages: Page[]
          customDomain?: string | null
          projectMedia?: Array<{ url: string; name: string }>
          blogPost?: { id: string; slug: string }
        }
      const isBlogFix = !!blogPost && pageSlug.startsWith('blog/')

      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) { emitError('ANTHROPIC_API_KEY non configurata'); return }

      // Auth + ownership + credits pre-check
      let authCtx: Awaited<ReturnType<typeof requireUserAndProject>>
      try {
        authCtx = await requireUserAndProject(req, projectId)
        await precheckCredits(authCtx.user.id, authCtx.supabase)
      } catch (authErr) {
        if (authErr instanceof CreditsError) {
          emitError(authErr.message)
          return
        }
        if (authErr instanceof ApiError) {
          emitError(authErr.message)
          return
        }
        throw authErr
      }
      const user = authCtx.user
      const supabase = authCtx.supabase
      const project = authCtx.project

      const siteConfig = (project?.site_config ?? {}) as Record<string, unknown>
      const context: ProjectContext = (siteConfig.context as ProjectContext) ?? {}
      const projectSlug = project?.slug ?? ''
      const tokens: TokenBag = { input: 0, output: 0 }

      const check = getCheck(checkId)
      const targetPage = pages.find(p => p.slug === pageSlug)
      if (!targetPage) { emitError(`Pagina "${pageSlug}" non trovata`); return }

      // Build canonical URL
      const baseUrl = customDomain
        ? `https://${customDomain}`
        : projectSlug ? `https://factulista.app/preview/${projectSlug}` : 'https://example.com'
      const pagePath = pageSlug === 'home' ? '' : `/${pageSlug}`
      const canonicalUrl = `${baseUrl}${pagePath}`

      // ── For SEO-owner checks: generate content first ──────────────────────
      let generated = ''
      if (check.fixOwner === 'seo') {
        emit(`🔍 Generando contenuto SEO per "${check.label}"…`, elapsed())

        const type = context.businessType ?? 'sito web'
        const data = checkResult.data as Record<string, unknown> | undefined

        // Resolve brand and language with smart fallbacks from the HTML
        const resolvedBrand = detectBrand(targetPage.html, context.businessName)
        const resolvedLang = detectLanguage(targetPage.html, context.language)
        const pageCtx = extractPageContext(targetPage.html)

        switch (checkId) {
          case 'title':
            generated = await generateTitle(targetPage.name, targetPage.html, resolvedBrand, type, resolvedLang, apiKey, context, tokens)
            break

          case 'meta-description':
            generated = await generateMetaDescription(targetPage.name, targetPage.html, resolvedBrand, type, resolvedLang, apiKey, context, tokens)
            break

          case 'h1-keyword':
            generated = await callSeoAgent(
              `Riscrivi l'H1 della pagina "${targetPage.name}" per includere la keyword primaria.
H1 attuale: "${(data?.text as string) ?? '(non trovato)'}". Business: ${type}, brand: "${resolvedBrand}".
${pageCtx}
Requisiti: naturale, 4–10 parole, contiene la keyword primaria, lingua: ${resolvedLang}.
Rispondi SOLO con il testo dell'H1.`, apiKey, context, tokens)
            break

          case 'open-graph': {
            const missing = (data?.missing as string[]) ?? ['og:title', 'og:description', 'og:image', 'og:url']

            // Pick the best og:image: prefer user-uploaded images over anything else.
            // Filter to likely web-displayable formats and avoid SVG (bad for og:image).
            const uploadedImages = (projectMedia ?? []).filter(m =>
              /\.(jpe?g|png|webp|gif)$/i.test(m.name)
            )
            // Also extract the first real image src already present in the page HTML
            const pageImgMatch = targetPage.html.match(/<img\b[^>]*src=["']([^"']+\.(jpe?g|png|webp))[^"']*["']/i)
            const pageImgUrl = pageImgMatch?.[1] ?? null

            const ogImageUrl =
              uploadedImages[0]?.url   // 1st priority: user's media library
              ?? pageImgUrl             // 2nd priority: first real image found in page HTML
              ?? null                   // 3rd: we'll instruct Claude to leave it out if missing

            const ogImageLine = ogImageUrl
              ? `og:image="${ogImageUrl}" (URL immagine reale — usa questo esatto)`
              : `og:image — NON inserire se non hai un URL immagine reale (meglio assente che un placeholder generico)`

            generated = await callSeoAgent(
              `Genera i tag Open Graph mancanti per la pagina "${targetPage.name}" di "${resolvedBrand}" (${type}).
${pageCtx}
Tag mancanti: ${missing.join(', ')}
URL canonico: ${canonicalUrl}
Requisiti:
- og:title ≤60 chars (usa la keyword primaria)
- og:description ≤200 chars (con CTA)
- og:url="${canonicalUrl}"
- ${ogImageLine}
Lingua contenuto: ${resolvedLang} — scrivi i testi in questa lingua.
Rispondi con i tag <meta> HTML completi pronti per il <head>, uno per riga. SOLO i tag, nient'altro.`,
              apiKey, context, tokens)
            break
          }

          case 'alt-text':
            generated = await callSeoAgent(
              `Analizza l'HTML e genera alt text SEO per le immagini senza alt nella pagina "${targetPage.name}" (${type}: "${resolvedBrand}").
${pageCtx}
HTML PAGINA (per identificare le immagini e il contesto):\n${targetPage.html.slice(0, 5000)}
Regole: alt conciso (max 125 chars), descrittivo, nella lingua ${resolvedLang}, niente "immagine di", usa keyword rilevanti.
Rispondi SOLO con JSON array: [{"src_fragment": "parte univoca e breve dell'URL src", "alt": "testo alt"}]`,
              apiKey, context, tokens)
            break

          case 'schema-organization':
            generated = await callSeoAgent(
              `Genera un JSON-LD Organization per il sito "${resolvedBrand}" (${type}).
${pageCtx}
URL sito: ${baseUrl}
Genera schema.org JSON-LD completo con: @context, @type, name, url, description (2-3 frasi in ${resolvedLang}).
Rispondi SOLO con il JSON puro, senza markdown, senza backtick.`,
              apiKey, context, tokens)
            break

          case 'schema-faq':
            generated = await callSeoAgent(
              `Analizza l'HTML della pagina "${targetPage.name}" ed estrai le FAQ per generare un JSON-LD FAQPage.
HTML PAGINA:\n${targetPage.html.slice(0, 6000)}
Genera schema.org FAQPage valido con tutte le domande/risposte trovate nella pagina.
Lingua: ${resolvedLang}. Rispondi SOLO con il JSON puro, senza markdown, senza backtick.`,
              apiKey, context, tokens)
            break
        }

        if (!generated) { emitError('Il SEO agent non ha generato contenuto'); return }
      }

      // ── Apply the fix directly on the HTML ────────────────────────────────
      emit(`✏️ Applicando fix: ${check.label}…`, elapsed())

      const updatedPages = pages.map(p => {
        if (p.slug !== pageSlug) return p
        const patched = applyHtmlFix(checkId, p.html, generated, {
          canonicalUrl,
          language: context.language || 'it',
          checkResult,
        })
        return { ...p, html: patched }
      })

      // Consume credits (fire-and-forget; LLM call already happened)
      const totalT = tokens.input + tokens.output
      if (totalT > 0) {
        consumeCredits(user.id, totalT, 'seo-fix', projectId, { input: tokens.input, output: tokens.output, checkId }, supabase)
          .catch((e: unknown) => console.error('[credits] seo-fix consume failed:', e))
      }

      // ── Persist to DB ──────────────────────────────────────────────────────
      if (isBlogFix && blogPost) {
        // For blog posts: extract the updated SEO fields and save to blog_posts table.
        // The fields stored in blog_posts (seo_title, seo_description) override the
        // defaults in buildBlogPostPage — no need to touch site_config.
        const patchedHtml = updatedPages.find(p => p.slug === pageSlug)?.html ?? ''
        const updates: Record<string, string | null> = {}

        if (checkId === 'title' || checkId === 'open-graph') {
          const titleMatch = patchedHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
          const ogTitleMatch = patchedHtml.match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
            ?? patchedHtml.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i)
          const raw = ogTitleMatch?.[1] ?? titleMatch?.[1] ?? null
          if (raw) updates.seo_title = raw.trim()
        }
        if (checkId === 'meta-description' || checkId === 'open-graph') {
          const metaMatch = patchedHtml.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
            ?? patchedHtml.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i)
          const ogDescMatch = patchedHtml.match(/<meta\b[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)
            ?? patchedHtml.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i)
          const raw = ogDescMatch?.[1] ?? metaMatch?.[1] ?? null
          if (raw) updates.seo_description = raw.trim()
        }

        if (Object.keys(updates).length > 0) {
          await supabase.from('blog_posts').update(updates).eq('id', blogPost.id)
        }

        emitDone({
          tool: 'seo_fix',
          checkId,
          updatedBlogPost: { id: blogPost.id, ...updates },
          summary: `✅ ${check.label} ottimizzato`,
        })
      } else {
        // Regular page: persist updated HTML to site_config
        const { data: currentProject } = await supabase
          .from('projects')
          .select('site_config')
          .eq('id', projectId)
          .single()

        const currentConfig = (currentProject?.site_config ?? {}) as Record<string, unknown>
        await supabase.from('projects').update({
          site_config: { ...currentConfig, pages: updatedPages },
          updated_at: new Date().toISOString(),
        }).eq('id', projectId)

        emitDone({ tool: 'seo_fix', checkId, updatedPages, summary: `✅ ${check.label} ottimizzato` })
      }

    } catch (err) {
      emitError(String(err))
    }
  })()

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  })
}
