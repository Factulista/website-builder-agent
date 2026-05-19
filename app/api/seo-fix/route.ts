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

// ── SEO content generator (for seo-owner checks) ─────────────────────────────

async function generateSeoContent(
  seoPrompt: string,
  pageHtml: string,
  apiKey: string,
  context: ProjectContext
): Promise<string> {
  const system = `Sei un SEO expert. Generi contenuti ottimizzati per i motori di ricerca.

${SEO_KNOWLEDGE}

${buildContextPrompt(context)}

Rispondi con SOLO il contenuto richiesto — nessuna spiegazione, nessun markdown, nessun tag HTML salvo quando esplicitamente richiesto.`

  const res = await callClaude(
    'seo',
    system,
    [{ role: 'user', content: `${seoPrompt}\n\nHTML DELLA PAGINA (per contesto):\n${pageHtml.slice(0, 4000)}` }],
    [],  // no tools — raw text response
    apiKey
  )

  if (!res.ok) throw new Error(`SEO content API error: ${await res.text()}`)
  const data = await res.json()
  const textBlock = data.content?.find((b: { type: string }) => b.type === 'text')
  return textBlock?.text?.trim() ?? ''
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

        // Build the seoAgentPrompt inline (mirrors prompt-builder logic)
        const lang = context.language || 'it'
        const brand = context.businessName ?? 'il brand'
        const type = context.businessType ?? 'web'
        const data = checkResult.data as Record<string, unknown> | undefined

        let seoPrompt = ''
        switch (checkId) {
          case 'title':
            seoPrompt = `Riscrivi il title tag della pagina "${targetPage.name}" di un sito ${type} chiamato "${brand}".
${data?.current ? `Title attuale (${data.length} chars): "${data.current}"` : 'Title attuale: mancante.'}
Requisiti: 50–60 caratteri esatti, keyword primaria, formato "[Keyword] — [Brand]" o "[Brand] | [Servizio]", lingua: ${lang}.
Rispondi SOLO con il testo del title, senza tag HTML.`
            break
          case 'meta-description':
            seoPrompt = `Scrivi la meta description per la pagina "${targetPage.name}" di un sito ${type} chiamato "${brand}".
${data?.current ? `Description attuale: "${data.current}"` : 'Description attuale: mancante.'}
Requisiti: 150–160 caratteri esatti, keyword primaria, CTA finale (es: "Scopri di più"), lingua: ${lang}.
Rispondi SOLO con il testo della description, senza tag HTML.`
            break
          case 'h1-keyword':
            seoPrompt = `Riscrivi l'H1 della pagina "${targetPage.name}" per includere la keyword primaria.
H1 attuale: "${data?.text ?? '(non trovato)'}". Business: ${type}, Brand: ${brand}.
Requisiti: naturale, 4–10 parole, keyword primaria, lingua: ${lang}.
Rispondi SOLO con il testo dell'H1, senza tag HTML.`
            break
          case 'open-graph': {
            const missing = (data?.missing as string[]) ?? ['og:title', 'og:description', 'og:image', 'og:url']
            seoPrompt = `Genera i tag Open Graph mancanti per la pagina "${targetPage.name}" di "${brand}" (${type}).
Tag mancanti: ${missing.join(', ')}. URL pagina: ${canonicalUrl}. Lingua: ${lang}.
Requisiti: og:title ≤60 chars, og:description ≤200 chars, og:url="${canonicalUrl}", og:image placeholder 1200x630 se non disponibile.
Rispondi con i tag HTML completi pronti per il <head>, uno per riga.`
            break
          }
          case 'alt-text': {
            const missingN = data?.missing ?? 'alcune'
            const totalN = data?.total ?? '?'
            seoPrompt = `Analizza l'HTML e genera alt text descrittivi per le immagini senza alt nella pagina "${targetPage.name}".
Immagini senza alt: ${missingN}/${totalN}. Tipo sito: ${type}. Lingua: ${lang}.
Per ogni immagine: alt conciso (max 125 chars), descrittivo, senza "immagine di". Considera src URL e testo vicino.
Rispondi con un JSON array: [{"src_fragment": "parte univoca dell'src", "alt": "testo alt"}]`
            break
          }
          case 'schema-organization':
            seoPrompt = `Genera un JSON-LD Organization/LocalBusiness per "${brand}" (${type}).
URL: ${baseUrl}. Lingua: ${lang}.
Genera schema.org JSON-LD con: @context, @type, name, url, description.
Rispondi SOLO con il JSON, senza markdown o backtick.`
            break
          case 'schema-faq':
            seoPrompt = `Analizza l'HTML della pagina "${targetPage.name}" e genera un JSON-LD FAQPage.
Estrai le domande e risposte dalla sezione FAQ. Lingua: ${lang}.
Genera schema.org FAQPage valido. Rispondi SOLO con il JSON, senza markdown o backtick.`
            break
        }

        if (seoPrompt) {
          generated = await generateSeoContent(seoPrompt, targetPage.html, apiKey, context)
          if (!generated) { emitError('Il SEO agent non ha generato contenuto'); return }
        }
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
