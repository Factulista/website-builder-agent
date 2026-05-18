import { callClaude } from './config'
import { fetchWithRetry } from './fetch-retry'

type Page = { slug: string; name: string; html: string }

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
  projectMedia: Array<{ url: string; name: string; alt?: string; title?: string }> = []
) {
  const hasPages = pages.length > 0
  const activePage = hasPages ? (pages.find(p => p.slug === activePageSlug) || pages[0]) : null
  const pagesOverview = hasPages
    ? pages.map(p => `- /${p.slug === 'home' ? '' : p.slug} ("${p.name}")`).join('\n')
    : 'Nessuna pagina ancora.'

  const mediaList = projectMedia.length > 0
    ? projectMedia.map(m => `- ${m.url}${m.alt ? ` (alt: "${m.alt}")` : ''}${m.title ? ` (titolo: "${m.title}")` : ''} — file: ${m.name}`).join('\n')
    : 'Nessuna immagine caricata dall\'utente.'

  // When editing an existing page, send a compact skeleton instead of full HTML.
  // The skeleton is 70-80% smaller: no CSS, no comments, text truncated to 80 chars.
  // The agent's find/replace strings are then applied against the ORIGINAL full HTML.
  const activePageContext = activePage
    ? `\nPAGINA ATTIVA: "${activePage.name}" (slug: "${activePage.slug}")
HTML ATTUALE (struttura — il CSS è omesso per brevità, il find/replace verrà applicato sull'HTML completo):
\`\`\`html
${buildHtmlSkeleton(activePage.html)}
\`\`\`
Modifiche generiche → modifica questa pagina.`
    : ''

  const system = `Sei un esperto web designer. Crei e modifichi siti web MULTI-PAGINA in HTML puro.

REGOLE:
- Nessun sito? Usa create_site (includi sempre pagina "home").
- Modifiche a pagina esistente: usa edit_page con find/replace mirati.
- Nuova pagina: usa add_page. Eliminare pagina: usa delete_page (non "home").

FIND/REPLACE: le stringhe "find" devono corrispondere ESATTAMENTE al testo nell'HTML originale completo (il CSS è presente anche se non mostrato qui).

LINK TRA PAGINE: usa link relativi senza .html — es: <a href="./">Home</a>, <a href="./chi-siamo">Chi Siamo</a>

OGNI PAGINA: HTML completo, CSS inline, mobile-friendly, design moderno e coerente tra pagine.

IMMAGINI — REGOLE DI PRIORITÀ (importante):
1. Se l'utente fornisce un URL esplicito nel messaggio → USA QUELL'URL ESATTO.
2. Se l'utente chiede di usare "una sua immagine" e la media library ha qualcosa di pertinente → usa quegli URL.
3. Altrimenti → usa placeholder https://picsum.photos/seed/{keyword}/{w}/{h}.

MEDIA LIBRARY DEL PROGETTO:
${mediaList}

PAGINE ATTUALI:
${pagesOverview}
${activePageContext}`

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
