import { callClaude } from './config'
import { fetchWithRetry } from './fetch-retry'
import type { LogoDefinition } from './design-agent'

type Page = { slug: string; name: string; html: string }

/**
 * Extracts the logo HTML element from the navbar of an existing page.
 * Looks for common logo class patterns: .nav-logo, .logo, .brand, .site-logo
 * Returns the full element HTML (e.g. <a class="nav-logo">…</a>) or null.
 */
function extractNavLogo(html: string): string | null {
  // Match anchor or div/span with logo-related class inside a <nav>
  const patterns = [
    /<a\b[^>]*class="[^"]*(?:nav-logo|site-logo|brand-logo)[^"]*"[^>]*>[\s\S]*?<\/a>/i,
    /<div\b[^>]*class="[^"]*(?:nav-logo|site-logo|brand-logo)[^"]*"[^>]*>[\s\S]*?<\/div>/i,
    /<a\b[^>]*class="[^"]*\blog[^"o][^"]*"[^>]*>[\s\S]*?<\/a>/i,  // class contains "log" (logo, logotype)
    /<span\b[^>]*class="[^"]*(?:logo|brand)[^"]*"[^>]*>[\s\S]*?<\/span>/i,
  ]
  for (const pattern of patterns) {
    const m = html.match(pattern)
    if (m) return m[0].replace(/\s+/g, ' ').trim()
  }
  return null
}

/**
 * Renders a LogoDefinition into an HTML string suitable for use in a navbar.
 * Used when the html agent builds new pages that need to match the stored logo.
 */
function renderLogoHtml(logo: LogoDefinition, href = './'): string {
  if (logo.type === 'img') {
    return `<a href="${href}" class="nav-logo" style="display:flex;align-items:center;text-decoration:none;">` +
      `<img src="${logo.content}" alt="logo" style="height:36px;width:auto;object-fit:contain;">` +
      `</a>`
  }
  if (logo.type === 'svg') {
    // Wrap the SVG in a link; replace any fill="currentColor" with the logo color
    const svgColored = logo.content.replace(/fill="currentColor"/gi, `fill="${logo.color}"`)
    return `<a href="${href}" class="nav-logo" style="display:flex;align-items:center;text-decoration:none;">${svgColored}</a>`
  }
  // type === 'text'
  const name = logo.content
  const accent = logo.accentChar
  const displayName = accent && name.includes(accent)
    ? name.replace(accent, `<span style="color:var(--color-accent,${logo.color})">${accent}</span>`)
    : name
  return `<a href="${href}" class="nav-logo" style="font-size:1.4rem;font-weight:800;color:${logo.color};text-decoration:none;letter-spacing:-0.5px;">${displayName}</a>`
}

/**
 * Builds a compact HTML skeleton for the LLM context:
 * - Removes <style> blocks (CSS is irrelevant for structural/text edits)
 * - Removes HTML comments
 * - Collapses whitespace
 * - Truncates long text nodes to 80 chars so the agent can still identify elements
 *   but the payload is 70-80% smaller than the full HTML.
 *
 * The find/replace strings produced by the agent are then applied against the
 * ORIGINAL full HTML — not the skeleton — so edits always work on the real content.
 */
function buildHtmlSkeleton(html: string): string {
  return html
    // Remove <style>...</style> blocks (not needed for structural/text edits)
    .replace(/<style[\s\S]*?<\/style>/gi, '<style>/* CSS omitted */</style>')
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    // Truncate long text nodes (keep first 80 chars + ellipsis)
    .replace(/>([^<]{80,})</g, (_, text) => `>${text.slice(0, 80).trimEnd()}…<`)
    .trim()
}

const HTML_TOOLS = [
  {
    name: 'create_site',
    description: 'Crea un sito multi-pagina da zero. Usalo SOLO per il primo sito o quando l\'utente chiede di rifare tutto.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              slug: { type: 'string' },
              name: { type: 'string' },
              html: { type: 'string' },
            },
            required: ['slug', 'name', 'html'],
          },
        },
        summary: { type: 'string' },
      },
      required: ['pages', 'summary'],
    },
  },
  {
    name: 'edit_page',
    description: 'Modifica UNA pagina specifica del sito con find/replace mirati.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pageSlug: { type: 'string' },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              find: { type: 'string' },
              replace: { type: 'string' },
            },
            required: ['find', 'replace'],
          },
        },
        summary: { type: 'string' },
      },
      required: ['pageSlug', 'edits', 'summary'],
    },
  },
  {
    name: 'add_page',
    description: 'Aggiunge una NUOVA pagina al sito esistente.',
    input_schema: {
      type: 'object' as const,
      properties: {
        slug: { type: 'string' },
        name: { type: 'string' },
        html: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['slug', 'name', 'html', 'summary'],
    },
  },
  {
    name: 'delete_page',
    description: 'Elimina una pagina dal sito. Non può eliminare "home".',
    input_schema: {
      type: 'object' as const,
      properties: {
        pageSlug: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['pageSlug', 'summary'],
    },
  },
]

export async function runHtmlAgentWithPlan(
  userRequest: string,
  plan: import('./planner').SitePlan,
  content: import('./content-agent').ContentOutput,
  design: import('./design-agent').DesignOutput,
  apiKey: string,
  existingPages: { slug: string; name: string }[] = []
) {
  const allPages = [
    ...existingPages,
    ...plan.pages.filter(p => !existingPages.some(ep => ep.slug === p.slug)),
  ]

  const system = `Sei un esperto sviluppatore HTML. Generi siti web HTML completi usando il contenuto e il design forniti.

REGOLE:
- Genera HTML completo (<!DOCTYPE html>...) per ogni pagina del piano.
- Usa ESCLUSIVAMENTE i testi forniti nel contenuto — non inventarne altri.
- Il CSS fornito contiene solo le variabili :root e il reset base. DEVI aggiungere tu tutto il CSS dei componenti (navbar, hero, button, card, footer, sezioni, media queries, ecc.) usando le CSS custom properties fornite.
- Includi Google Fonts: ${design.googleFontsUrl ?? 'nessuno'}
- Link tra pagine con href relativi senza .html (es: ./chi-siamo).
- Includi Schema.org JSON-LD nel <head> dove fornito.
- Mobile-first, semantico, accessibile.
${allPages.length > plan.pages.length ? `- TUTTE LE PAGINE DEL SITO (per i link navbar): ${allPages.map(p => `${p.name} → ./${p.slug === 'home' ? '' : p.slug}`).join(', ')}` : ''}`

  const userMessage = `Richiesta: ${userRequest}

PIANO:
${plan.pages.map(p => `- ${p.slug}: sezioni ${p.sections.join(', ')}`).join('\n')}

CSS:
${design.css}

CONTENUTO PER PAGINA:
${content.pages.map(p => `
=== ${p.slug} ===
Title: ${p.title}
Meta: ${p.metaDescription}
H1: ${p.h1}
Sezioni: ${JSON.stringify(p.sections)}
Schema: ${p.schemaOrg ?? 'nessuno'}
`).join('\n')}`

  const tools = [
    {
      name: 'create_site',
      description: 'Genera tutte le pagine HTML del sito.',
      input_schema: {
        type: 'object' as const,
        properties: {
          pages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                slug: { type: 'string' },
                name: { type: 'string' },
                html: { type: 'string' },
              },
              required: ['slug', 'name', 'html'],
            },
          },
          summary: { type: 'string' },
        },
        required: ['pages', 'summary'],
      },
    },
  ]

  const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16384,
      system,
      tools,
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: userMessage }],
    }),
  }, 'html')

  if (!res.ok) throw new Error(`HTML Agent (pipeline) error: ${await res.text()}`)
  const data = await res.json()
  const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
  if (!toolUse) throw new Error('No tool use in HTML pipeline response')
  return toolUse.input as { pages: Page[]; summary: string }
}

export async function runHtmlAgentFromTemplate(
  userRequest: string,
  plan: import('./planner').SitePlan,
  content: import('./content-agent').ContentOutput,
  design: import('./design-agent').DesignOutput,
  templateHtml: string,
  apiKey: string
) {
  const pageContent = content.pages[0]

  const system = `Sei un esperto sviluppatore HTML. Ricevi un template HTML con placeholder {{chiave}} e devi sostituirli con i contenuti forniti.

REGOLE:
- Sostituisci TUTTI i placeholder {{...}} con i valori appropriati dal contenuto fornito.
- Adatta il colore primario (var(--accent)) a: ${design.tokens?.colors?.primary ?? '#6366f1'}
- Adatta i font al design fornito.
- Usa ESCLUSIVAMENTE i testi forniti — non inventarne altri.
- Restituisci l'HTML completo con tutti i placeholder sostituiti.
- Per i placeholder senza valore diretto (es: loghi, testimonial), usa valori plausibili coerenti col brand.`

  const userMessage = `Richiesta originale: ${userRequest}

CONTENUTO DA USARE:
App name: ${plan.businessType}
Title: ${pageContent?.title ?? ''}
H1: ${pageContent?.h1 ?? ''}
Meta: ${pageContent?.metaDescription ?? ''}
Sezioni: ${JSON.stringify(pageContent?.sections ?? [])}
Lingua: ${plan.pages[0]?.slug ?? 'home'}

DESIGN:
Colore primario: ${design.tokens?.colors?.primary ?? '#6366f1'}
Font heading: ${design.tokens?.fonts?.heading ?? 'Inter'}
CSS aggiuntivo: ${design.css?.slice(0, 500) ?? ''}

TEMPLATE DA RIEMPIRE:
${templateHtml}`

  const tools = [{
    name: 'create_site',
    description: 'Ritorna le pagine HTML con i placeholder sostituiti.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              slug: { type: 'string' },
              name: { type: 'string' },
              html: { type: 'string' },
            },
            required: ['slug', 'name', 'html'],
          },
        },
        summary: { type: 'string' },
      },
      required: ['pages', 'summary'],
    },
  }]

  const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16384,
      system: [
        { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
      ],
      tools,
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: userMessage }],
    }),
  }, 'html')

  if (!res.ok) throw new Error(`HTML Template Agent error: ${await res.text()}`)
  const data = await res.json()
  const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
  if (!toolUse) throw new Error('No tool use in HTML template response')
  return toolUse.input as { pages: Page[]; summary: string }
}

export async function runHtmlAgent(
  messages: { role: string; content: string }[],
  pages: Page[],
  activePageSlug: string | null,
  apiKey: string,
  projectMedia: Array<{ url: string; name: string; alt?: string; title?: string }> = [],
  contextLogo?: LogoDefinition
) {
  const hasPages = pages.length > 0
  const activePage = hasPages ? (pages.find(p => p.slug === activePageSlug) || pages[0]) : null

  const mediaList = projectMedia.length > 0
    ? projectMedia.map(m => `- ${m.url}${m.alt ? ` (alt: "${m.alt}")` : ''}${m.title ? ` (titolo: "${m.title}")` : ''} — file: ${m.name}`).join('\n')
    : 'Nessuna immagine caricata dall\'utente.'

  // ── Logo context ────────────────────────────────────────────────────────────
  // Priority: 1) logo extracted from existing pages HTML, 2) logo from saved design context
  const extractedLogo = pages.length > 0 ? extractNavLogo(pages[0].html) : null
  const logoSection = (() => {
    if (extractedLogo) {
      return `\nLOGO ESISTENTE — copialo IDENTICO in ogni <nav> delle pagine che crei o modifichi. NON reinventarlo:\n\`\`\`html\n${extractedLogo}\n\`\`\``
    }
    if (contextLogo) {
      const rendered = renderLogoHtml(contextLogo)
      return `\nLOGO DA USARE (dal design system) — usalo IDENTICO in ogni <nav>:\n\`\`\`html\n${rendered}\n\`\`\`\nColore logo: ${contextLogo.color}`
    }
    return ''
  })()

  // Build context: active page gets full CSS, other pages get skeleton.
  // When user asks to copy styles FROM another page, we include that page's <style> block too.
  const userMsg = messages[messages.length - 1]?.content?.toLowerCase() ?? ''

  // Detect pages mentioned in the user's message (by slug or name) so we can provide their CSS
  const mentionedPages = pages.filter(p => {
    const slug = p.slug.toLowerCase()
    const name = p.name.toLowerCase()
    return userMsg.includes(slug) || userMsg.includes(name)
  })

  // Extract <style> block from a page's HTML
  const extractStyle = (html: string): string => {
    const match = html.match(/<style[\s\S]*?<\/style>/i)
    return match ? match[0] : ''
  }

  // Build per-page context blocks
  const pageContextBlocks = pages.map(p => {
    const isActive = p.slug === activePage?.slug
    const isMentioned = mentionedPages.some(mp => mp.slug === p.slug)

    if (isActive) {
      return `\n=== PAGINA ATTIVA: "${p.name}" (slug: "${p.slug}") ===
HTML ATTUALE (struttura — CSS omesso per brevità, il find/replace si applica sull'HTML completo):
\`\`\`html
${buildHtmlSkeleton(p.html)}
\`\`\``
    } else if (isMentioned) {
      // For explicitly mentioned pages: show skeleton + full <style> so agent can reference/copy CSS
      const styleBlock = extractStyle(p.html)
      return `\n=== PAGINA CITATA: "${p.name}" (slug: "${p.slug}") ===
HTML STRUTTURA:
\`\`\`html
${buildHtmlSkeleton(p.html)}
\`\`\`
${styleBlock ? `CSS COMPLETO (per copiare stili da questa pagina):
\`\`\`css
${styleBlock}
\`\`\`` : ''}`
    } else {
      return `- "${p.name}" (slug: "${p.slug}") — disponibile per modifica`
    }
  }).join('\n')

  const system = `Sei un esperto web designer. Crei e modifichi siti web MULTI-PAGINA in HTML puro.

REGOLE CRITICHE:
- Nessun sito? Usa create_site (includi sempre pagina "home").
- Modifiche a pagina esistente: usa edit_page con find/replace mirati.
- Nuova pagina: usa add_page. Eliminare pagina: usa delete_page (non "home").

TARGETING DELLA PAGINA — IMPORTANTISSIMO:
- Se l'utente nomina esplicitamente una pagina (es: "nella pagina precios", "sulla pagina contatti", "per la pagina about"), usa edit_page su QUELLA pagina — NON sulla pagina attiva.
- "Anche nella pagina X" = edita la pagina X.
- Se l'utente dice "fai X come nella home" = la home è il RIFERIMENTO (sorgente), non il target da editare.
- La pagina attiva è solo il default quando l'utente non specifica.

LOGO — REGOLE FONDAMENTALI:
- Se è indicato un "LOGO ESISTENTE" qui sotto, copialo VERBATIM in ogni <nav>. Non modificarne struttura, colori o contenuto salvo richiesta esplicita.
- Se l'utente chiede di cambiare colore al logo SVG, usa edit_page con find/replace sul valore fill (es: find fill="#000000" replace fill="#2563eb"). Non riscrivere tutto l'HTML.
- Se l'utente carica un'immagine logo (URL in media library), sostituisci l'elemento logo con <img src="URL" alt="logo" style="height:36px;width:auto;">.
- Quando crei un sito nuovo senza logo definito, crea un logo testuale semplice: <a href="./" class="nav-logo" style="font-size:1.4rem;font-weight:800;color:[colore_coerente];text-decoration:none;">[nome brand]</a>. Puoi colorare un carattere con l'accent color.
- Il logo DEVE essere identico su tutte le pagine del sito.

FIND/REPLACE: le stringhe "find" devono corrispondere ESATTAMENTE al testo nell'HTML originale completo (il CSS è presente anche se non mostrato qui).

LINK TRA PAGINE: usa link relativi senza .html — es: <a href="./">Home</a>, <a href="./chi-siamo">Chi Siamo</a>

OGNI PAGINA: HTML completo, CSS inline, mobile-friendly, design moderno e coerente tra pagine.

SEO — REGOLE DI DEFAULT (applica SEMPRE su ogni pagina che crei o modifichi):
- <title> presente, 50–60 chars, con keyword primaria. Formato: "Keyword — Brand" o "Brand | Servizio".
- <meta name="description"> presente, 150–160 chars, termina con CTA.
- <link rel="canonical" href="[URL_PAGINA]"> nella <head>.
- <html lang="[LINGUA]"> — usa la lingua del sito (it/es/en/...).
- Un solo <h1> per pagina, contenente la keyword principale.
- Gerarchia heading corretta: H1→H2→H3 senza salti.
- Tag semantici: <header>, <nav>, <main>, <footer>.
- Ogni <img> ha: alt="[descrizione]", width, height, loading="lazy" (tranne la prima above-the-fold).
- <link rel="preconnect" href="https://fonts.googleapis.com"> se usi Google Fonts.
- og:title, og:description, og:url nella <head> (og:image se hai URL immagine).
Queste regole si applicano ANCHE alle modifiche parziali: se aggiungi una sezione, assicurati che la pagina soddisfi questi requisiti.

IMMAGINI — REGOLE DI PRIORITÀ (importante):
1. Se l'utente fornisce un URL esplicito nel messaggio → USA QUELL'URL ESATTO.
2. Se l'utente chiede di usare "una sua immagine" e la media library ha qualcosa di pertinente → usa quegli URL.
3. Altrimenti → usa placeholder https://picsum.photos/seed/{keyword}/{w}/{h}.

MEDIA LIBRARY DEL PROGETTO:
${mediaList}
${logoSection}
PAGINE DEL SITO:
${pageContextBlocks}`

  // Send only the last 6 messages (3 exchanges) to avoid ballooning history tokens
  const recentMessages = messages.slice(-6)

  const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16384,
      system,
      tools: HTML_TOOLS,
      tool_choice: { type: 'any' },
      messages: recentMessages.map(m => ({ role: m.role, content: m.content })),
    }),
  }, 'html')

  if (!res.ok) throw new Error(`Anthropic API error: ${await res.text()}`)
  const data = await res.json()
  const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
  if (!toolUse) throw new Error('No tool use in response')
  return { tool: toolUse.name, input: toolUse.input, usage: data.usage }
}
