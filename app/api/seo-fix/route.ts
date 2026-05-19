import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { callClaude } from '../../../lib/agents/config'
import { SEO_KNOWLEDGE } from '../../../lib/agents/knowledge/seo'
import { buildContextPrompt, type ProjectContext } from '../../../lib/agents/memory-agent'
import { getCheck } from '../../../lib/seo/checks'
import type { CheckId } from '../../../lib/seo/checks'
import type { CheckResult } from '../../../lib/seo/analyzer'

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
        // Missing H1 — insert one before first H2 or after opening <main>/<body>
        const h2Match = html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)
        if (h2Match) {
          return html.replace(h2Match[0], `<h1>${h2Match[1]}</h1>\n${h2Match[0]}`)
        }
        return html
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
      // Best-effort: walk headings in order and fix level skips
      // e.g. H1 → H3 becomes H1 → H2; H2 → H4 becomes H2 → H3
      let prevLevel = 0
      return html.replace(/<(\/?)h([1-6])(\b[^>]*)>/gi, (_m, slash, lvl, rest) => {
        const n = parseInt(lvl, 10)
        if (slash) { prevLevel = Math.max(0, prevLevel - 1); return `</h${n}${rest}>` }
        const expected = prevLevel === 0 ? 1 : Math.min(n, prevLevel + 1)
        prevLevel = expected
        return n === expected ? `<h${n}${rest}>` : `<h${expected}${rest}>`
      })
    }

    case 'semantic-html': {
      const data = checkResult?.data as { missing?: string[] } | undefined
      const missing = data?.missing ?? []
      // Wrap <nav> around the first <ul> inside a nav-looking element if nav is missing
      if (missing.includes('main')) {
        // Wrap everything between header/nav and footer in <main>
        if (!/<main\b/i.test(html)) {
          html = html.replace(/(<\/(?:header|nav)>)([\s\S]*?)(<(?:footer|script)\b)/i,
            (_m, after, mid, before) => `${after}\n<main>${mid}</main>\n${before}`)
        }
      }
      if (missing.includes('header') && !/<header\b/i.test(html)) {
        html = html.replace(/(<nav\b[^>]*>[\s\S]*?<\/nav>)/i, `<header>\n$1\n</header>`)
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
  context: ProjectContext
): Promise<string> {
  const system = `Sei un SEO copywriter esperto. Generi testi ottimizzati per i motori di ricerca.

${buildContextPrompt(context)}

REGOLA ASSOLUTA: rispondi con SOLO il testo richiesto — zero spiegazioni, zero markdown, zero tag HTML (salvo quando esplicitamente richiesto). Nessuna frase introduttiva, nessun commento finale.`

  const res = await callClaude('seo', system,
    [{ role: 'user', content: userPrompt }],
    [], apiKey)

  if (!res.ok) throw new Error(`SEO content API error: ${await res.text()}`)
  const data = await res.json()
  const textBlock = data.content?.find((b: { type: string }) => b.type === 'text')
  return textBlock?.text?.trim() ?? ''
}

// Generates title with strict 50–60 char validation + up to 3 retries
async function generateTitle(
  pageName: string, html: string, brand: string, type: string, lang: string, apiKey: string, context: ProjectContext
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

    const result = await callSeoAgent(prompt, apiKey, context)
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
  pageName: string, html: string, brand: string, type: string, lang: string, apiKey: string, context: ProjectContext
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

    const result = await callSeoAgent(prompt, apiKey, context)
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
      const { projectId, pageSlug, checkId, checkResult, pages, customDomain } =
        await req.json() as {
          projectId: string
          pageSlug: string
          checkId: CheckId
          checkResult: CheckResult
          pages: Page[]
          customDomain?: string | null
        }

      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) { emitError('ANTHROPIC_API_KEY non configurata'); return }

      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )
      const { data: project } = await supabase
        .from('projects')
        .select('site_config, slug')
        .eq('id', projectId)
        .single()

      const siteConfig = (project?.site_config ?? {}) as Record<string, unknown>
      const context: ProjectContext = (siteConfig.context as ProjectContext) ?? {}
      const projectSlug = project?.slug ?? ''

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
            generated = await generateTitle(targetPage.name, targetPage.html, resolvedBrand, type, resolvedLang, apiKey, context)
            break

          case 'meta-description':
            generated = await generateMetaDescription(targetPage.name, targetPage.html, resolvedBrand, type, resolvedLang, apiKey, context)
            break

          case 'h1-keyword':
            generated = await callSeoAgent(
              `Riscrivi l'H1 della pagina "${targetPage.name}" per includere la keyword primaria.
H1 attuale: "${(data?.text as string) ?? '(non trovato)'}". Business: ${type}, brand: "${resolvedBrand}".
${pageCtx}
Requisiti: naturale, 4–10 parole, contiene la keyword primaria, lingua: ${resolvedLang}.
Rispondi SOLO con il testo dell'H1.`, apiKey, context)
            break

          case 'open-graph': {
            const missing = (data?.missing as string[]) ?? ['og:title', 'og:description', 'og:image', 'og:url']
            generated = await callSeoAgent(
              `Genera i tag Open Graph mancanti per la pagina "${targetPage.name}" di "${resolvedBrand}" (${type}).
${pageCtx}
Tag mancanti: ${missing.join(', ')}
URL canonico: ${canonicalUrl}
Requisiti: og:title ≤60 chars (usa la keyword primaria), og:description ≤200 chars (con CTA), og:url="${canonicalUrl}", og:image="https://placehold.co/1200x630" se non disponibile.
Lingua contenuto: ${resolvedLang} — scrivi i testi in questa lingua.
Rispondi con i tag <meta> HTML completi pronti per il <head>, uno per riga. SOLO i tag, nient'altro.`,
              apiKey, context)
            break
          }

          case 'alt-text':
            generated = await callSeoAgent(
              `Analizza l'HTML e genera alt text SEO per le immagini senza alt nella pagina "${targetPage.name}" (${type}: "${resolvedBrand}").
${pageCtx}
HTML PAGINA (per identificare le immagini e il contesto):\n${targetPage.html.slice(0, 5000)}
Regole: alt conciso (max 125 chars), descrittivo, nella lingua ${resolvedLang}, niente "immagine di", usa keyword rilevanti.
Rispondi SOLO con JSON array: [{"src_fragment": "parte univoca e breve dell'URL src", "alt": "testo alt"}]`,
              apiKey, context)
            break

          case 'schema-organization':
            generated = await callSeoAgent(
              `Genera un JSON-LD Organization per il sito "${resolvedBrand}" (${type}).
${pageCtx}
URL sito: ${baseUrl}
Genera schema.org JSON-LD completo con: @context, @type, name, url, description (2-3 frasi in ${resolvedLang}).
Rispondi SOLO con il JSON puro, senza markdown, senza backtick.`,
              apiKey, context)
            break

          case 'schema-faq':
            generated = await callSeoAgent(
              `Analizza l'HTML della pagina "${targetPage.name}" ed estrai le FAQ per generare un JSON-LD FAQPage.
HTML PAGINA:\n${targetPage.html.slice(0, 6000)}
Genera schema.org FAQPage valido con tutte le domande/risposte trovate nella pagina.
Lingua: ${resolvedLang}. Rispondi SOLO con il JSON puro, senza markdown, senza backtick.`,
              apiKey, context)
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

      // ── Persist to DB ──────────────────────────────────────────────────────
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

    } catch (err) {
      emitError(String(err))
    }
  })()

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  })
}
