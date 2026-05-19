// ── SEO Fix Prompt Builder ─────────────────────────────────────────────────────
// Builds targeted, surgical prompts for each of the 15 SEO checks.
// HTML-owner checks → prompt for html agent (edit_page with precise find/replace).
// SEO-owner checks  → prompt for seo agent (generate content) + inject instruction.

import type { CheckId } from './checks'
import type { CheckResult } from './analyzer'

type Page = { slug: string; name: string; html: string }

export type FixPrompt = {
  /** Prompt sent to the html agent (or the first stage for seo-owner checks) */
  agentPrompt: string
  /** For seo-owner checks: additional context to pass to the SEO agent first */
  seoAgentPrompt?: string
}

export function buildFixPrompt(
  checkId: CheckId,
  page: Page,
  result: CheckResult,
  opts: {
    customDomain?: string | null
    projectSlug?: string
    language?: string
    businessName?: string
    businessType?: string
  } = {}
): FixPrompt {
  const { customDomain, projectSlug, language = 'it', businessName, businessType } = opts
  const slug = page.slug
  const pageName = page.name

  // Build canonical base URL
  const baseUrl = customDomain
    ? `https://${customDomain}`
    : projectSlug
      ? `https://factulista.app/preview/${projectSlug}`
      : ''
  const pagePath = slug === 'home' ? '' : `/${slug}`
  const canonicalUrl = baseUrl ? `${baseUrl}${pagePath}` : `https://example.com${pagePath}`

  switch (checkId) {
    // ── HTML-owner fixes (structural — no content generation) ──────────────────

    case 'canonical':
      return {
        agentPrompt: `Nella pagina "${pageName}", aggiungi il tag canonical nella sezione <head>, subito dopo il tag <title>.
Il tag da inserire è: <link rel="canonical" href="${canonicalUrl}">
Usa edit_page con find/replace ESATTO. Se un canonical esiste già, aggiorna l'href. Non toccare nient'altro.`,
      }

    case 'lang': {
      const lang = language || 'it'
      return {
        agentPrompt: `Nella pagina "${pageName}", assicurati che il tag <html> abbia l'attributo lang="${lang}".
Se il tag è <html> senza lang, cambialo in <html lang="${lang}">.
Se ha già un lang diverso, aggiornalo a "${lang}".
Usa edit_page. Non toccare nient'altro.`,
      }
    }

    case 'h1-unique': {
      const data = result.data as { count: number; texts?: string[] } | undefined
      if (!data || data.count === 0) {
        return {
          agentPrompt: `Nella pagina "${pageName}" manca l'H1. Aggiungi un H1 come primo heading della sezione hero/main content, con il titolo principale della pagina. Usa edit_page.`,
        }
      }
      return {
        agentPrompt: `Nella pagina "${pageName}" ci sono ${data.count} tag H1, ma ne deve esserci esattamente 1.
Mantieni il primo H1 e converti tutti gli altri in H2. Usa edit_page con find/replace per ogni H1 extra.`,
      }
    }

    case 'heading-hierarchy': {
      const data = result.data as { issues: string[] } | undefined
      return {
        agentPrompt: `Nella pagina "${pageName}" la gerarchia degli heading non è corretta.
Problemi rilevati: ${data?.issues?.join(', ') || 'salti di livello heading'}.
Correggi i salti di livello: un H3 che segue un H1 diventano H2, un H4 che segue un H2 diventa H3, ecc.
Usa edit_page con find/replace precisi. Non cambiare il testo degli heading, solo i tag.`,
      }
    }

    case 'semantic-html': {
      const data = result.data as { missing: string[] } | undefined
      const missing = data?.missing ?? []
      return {
        agentPrompt: `Nella pagina "${pageName}" mancano questi tag semantici HTML5: ${missing.map(t => `<${t}>`).join(', ')}.
${missing.includes('main') ? '- Avvolgi il contenuto principale (tutto tra navbar e footer) in <main>.' : ''}
${missing.includes('header') ? '- Avvolgi la navbar in <header>.' : ''}
${missing.includes('footer') ? '- Assicurati che il footer sia in un tag <footer>.' : ''}
${missing.includes('nav') ? '- Avvolgi la navigazione in <nav>.' : ''}
Usa edit_page con find/replace. Mantieni tutte le classi e gli stili esistenti.`,
      }
    }

    case 'img-dimensions': {
      return {
        agentPrompt: `Nella pagina "${pageName}" alcune immagini mancano degli attributi width e height.
Per ogni <img> che non ha width e height:
- Se l'img usa picsum.photos: estrai le dimensioni dall'URL (es: /800/400 → width="800" height="400").
- Altrimenti: aggiungi width="100%" height="auto" come fallback.
Usa edit_page. Modifica solo i tag img mancanti, non toccare le immagini che hanno già width/height.`,
      }
    }

    case 'lazy-loading': {
      return {
        agentPrompt: `Nella pagina "${pageName}" alcune immagini non hanno loading="lazy".
Aggiungi loading="lazy" a tutte le <img> tranne la prima (che è above-the-fold e non deve essere lazy).
Usa edit_page con find/replace. Cerca ogni <img> che non ha già loading= e aggiungi l'attributo.`,
      }
    }

    case 'font-preconnect': {
      return {
        agentPrompt: `Nella pagina "${pageName}", aggiungi il preconnect per Google Fonts nella sezione <head>, come primissimo tag dopo <head>:
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
Usa edit_page. Se questi tag esistono già, non fare nulla.`,
      }
    }

    // ── SEO-owner fixes (require content generation) ───────────────────────────

    case 'title': {
      const data = result.data as { current?: string; length?: number; missing?: boolean } | undefined
      const current = data?.current ?? ''
      return {
        seoAgentPrompt: `Sei un SEO expert. Riscrivi il title tag della pagina "${pageName}" di un sito ${businessType ?? 'web'} chiamato "${businessName ?? 'il brand'}".
${current ? `Title attuale (${data?.length} chars): "${current}"` : 'Title attuale: mancante.'}
Requisiti:
- 50–60 caratteri esatti
- Contiene la keyword primaria della pagina
- Formato: [Keyword principale] — [Brand name] OPPURE [Brand name] | [Servizio]
- Lingua: ${language}
Rispondi SOLO con il testo del title, senza tag HTML.`,
        agentPrompt: `Nella pagina "${pageName}", ${current ? `cambia il title tag da "${current.slice(0, 80)}" a` : 'aggiungi il title tag con'} [NUOVO_TITLE].
Usa edit_page. Il tag deve essere: <title>[NUOVO_TITLE]</title>`,
      }
    }

    case 'meta-description': {
      const data = result.data as { current?: string; missing?: boolean } | undefined
      const current = data?.current ?? ''
      return {
        seoAgentPrompt: `Sei un SEO expert. Scrivi la meta description per la pagina "${pageName}" di un sito ${businessType ?? 'web'} chiamato "${businessName ?? 'il brand'}".
${current ? `Description attuale: "${current}"` : 'Description attuale: mancante.'}
Requisiti:
- 150–160 caratteri esatti
- Include la keyword primaria della pagina
- Termina con un CTA (es: "Scopri di più", "Prova gratis", "Contattaci")
- Lingua: ${language}
Rispondi SOLO con il testo della description, senza tag HTML.`,
        agentPrompt: `Nella pagina "${pageName}", ${current ? 'aggiorna la meta description' : 'aggiungi la meta description'} con: [NUOVA_DESCRIPTION].
Il tag da usare è: <meta name="description" content="[NUOVA_DESCRIPTION]">
Usa edit_page. Inserisci nella sezione <head> dopo il title.`,
      }
    }

    case 'h1-keyword': {
      const data = result.data as { text?: string } | undefined
      return {
        seoAgentPrompt: `Sei un SEO expert. Riscrivi l'H1 della pagina "${pageName}" per incluedere la keyword primaria.
H1 attuale: "${data?.text ?? '(non trovato)'}"
Business: ${businessType ?? 'non specificato'}, Brand: ${businessName ?? 'non specificato'}
Requisiti: naturale, 4–10 parole, contiene keyword primaria, lingua: ${language}
Rispondi SOLO con il testo dell'H1, senza tag HTML.`,
        agentPrompt: `Nella pagina "${pageName}", aggiorna il testo dell'H1 da "${(data?.text ?? '').slice(0, 80)}" a [NUOVO_H1].
Usa edit_page con find/replace esatto sul contenuto testuale dell'H1.`,
      }
    }

    case 'open-graph': {
      const data = result.data as { missing?: string[] } | undefined
      const missing = data?.missing ?? ['og:title', 'og:description', 'og:image', 'og:url']
      return {
        seoAgentPrompt: `Sei un SEO expert. Genera i tag Open Graph mancanti per la pagina "${pageName}".
Tag mancanti: ${missing.join(', ')}
Business: ${businessType ?? ''}, Brand: ${businessName ?? ''}
URL pagina: ${canonicalUrl}
Requisiti: og:title (60 chars max), og:description (200 chars max), og:image (1200x630 placeholder se non disponibile), og:url (URL canonico)
Lingua: ${language}
Rispondi con i tag HTML completi, uno per riga.`,
        agentPrompt: `Nella pagina "${pageName}", aggiungi i seguenti tag Open Graph nella sezione <head>:
[OG_TAGS]
Usa edit_page. Inserisci dopo i tag <meta name="description">.`,
      }
    }

    case 'alt-text': {
      const data = result.data as { missing?: number; total?: number } | undefined
      return {
        seoAgentPrompt: `Sei un SEO expert. Analizza l'HTML della pagina "${pageName}" e genera alt text descrittivi per le immagini che ne sono prive.
Immagini senza alt: ${data?.missing ?? 'alcune'}/${data?.total ?? '?'} totali.
Per ogni immagine, considera: src URL (contiene keywords?), contesto circostante (testo vicino), tipo di sito (${businessType ?? 'web'}).
Genera alt text concisi (max 125 chars), descrittivi, senza "immagine di" all'inizio.
Lingua: ${language}
Rispondi con un JSON array: [{"src_fragment": "...", "alt": "..."}]`,
        agentPrompt: `Nella pagina "${pageName}", aggiungi o aggiorna l'attributo alt sulle immagini che ne sono prive, usando i testi generati: [ALT_TEXTS].
Usa edit_page con find/replace per ogni img tag mancante di alt.`,
      }
    }

    case 'schema-organization': {
      return {
        seoAgentPrompt: `Sei un SEO expert. Genera un JSON-LD Organization/LocalBusiness per la pagina "${pageName}".
Business: ${businessName ?? 'da determinare'}, tipo: ${businessType ?? 'Organization'}
URL: ${canonicalUrl.replace(pagePath, '')}
Genera uno schema.org JSON-LD completo con: @context, @type, name, url, description.
Rispondi SOLO con il JSON, senza markdown.`,
        agentPrompt: `Nella pagina "${pageName}", aggiungi questo JSON-LD nella sezione <head> prima di </head>:
<script type="application/ld+json">[SCHEMA_JSON]</script>
Usa edit_page. Se esiste già un Organization schema, aggiornalo.`,
      }
    }

    case 'schema-faq': {
      return {
        seoAgentPrompt: `Sei un SEO expert. Analizza l'HTML della pagina "${pageName}" e genera un JSON-LD FAQPage.
Estrai le domande e risposte dalla sezione FAQ della pagina.
Genera uno schema.org FAQPage completo e valido.
Rispondi SOLO con il JSON, senza markdown.`,
        agentPrompt: `Nella pagina "${pageName}", aggiungi questo JSON-LD FAQ nella sezione <head> prima di </head>:
<script type="application/ld+json">[SCHEMA_JSON]</script>
Usa edit_page.`,
      }
    }

    default:
      return {
        agentPrompt: `Ottimizza il check SEO "${checkId}" nella pagina "${pageName}". Usa edit_page.`,
      }
  }
}
