import { fetchWithRetry } from './fetch-retry'
import { buildContextPrompt, type ProjectContext } from './memory-agent'

const COMPONENT_TOOL = {
  name: 'create_component',
  description: 'Genera un blocco HTML standalone (sezione, card, hero, pricing, form, testimonial, FAQ, ecc.)',
  input_schema: {
    type: 'object' as const,
    properties: {
      html: {
        type: 'string',
        description: 'HTML del componente con <style> interno. NO <html>/<body>/<head>. Solo il blocco.',
      },
      summary: {
        type: 'string',
        description: 'Breve descrizione del componente generato (1 frase)',
      },
    },
    required: ['html', 'summary'],
  },
}

/**
 * runComponentAgent — generates a standalone HTML+CSS block (section, card, hero, etc.)
 * that can be inserted into any page of the site.
 *
 * Context is minimal: only design tokens + user request + optional reference image.
 * No page HTML skeleton — this is intentional to keep the context small and the
 * agent focused on generating a clean, reusable component.
 */
/**
 * Extracts the first <style> block from a component HTML string.
 * Returns the content between <style>…</style> tags, or empty string if none.
 */
export function extractComponentStyle(html: string): string {
  const match = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i)
  return match ? match[1].trim() : ''
}

export async function runComponentAgent(
  userMessage: string,
  designTokensCss: string,
  apiKey: string,
  context: ProjectContext = {},
  imageBase64?: { data: string; media_type: string },
  /** CSS from the previously generated component — used to keep visual consistency */
  previousComponentStyle?: string
): Promise<{ html: string; summary: string; usage?: object }> {
  const styleMemoryBlock = previousComponentStyle
    ? `\nSTILE DI RIFERIMENTO (mantieni coerenza visiva con i componenti precedenti — stessa "voce stilistica"):
\`\`\`css
${previousComponentStyle}
\`\`\`
Rispetta: border-radius, padding proporzionali, shadow depth, dimensioni tipografiche, spaziatura tra sezioni. Adatta al nuovo contenuto ma non reinventare lo stile da zero.\n`
    : ''

  const system = `Sei un esperto UI designer specializzato in componenti web moderni. Generi blocchi HTML standalone — sezioni, card, hero, pricing, form, testimonial, FAQ, tabelle, ecc. — pronti per essere inseriti in qualsiasi pagina.

REGOLE FONDAMENTALI:
- Genera SOLO il blocco richiesto. NON includere <html>, <body>, <head> o struttura di pagina.
- Struttura obbligatoria: prima un <style>…</style> con tutti i CSS del componente, poi il markup.
- Usa le CSS custom properties del design system per colori e font — non inventare colori propri.
- Mobile-first: il layout deve funzionare su mobile (≤640px) con media queries o CSS fluid.
- Hover state su bottoni e card interattive.
- Nessuna riga vuota nell'HTML.
- NON usare JavaScript, framework o librerie esterne — solo HTML e CSS vanilla.
- Alt text su tutte le immagini placeholder.
- Usa https://picsum.photos/seed/{keyword}/{w}/{h} per placeholder immagini.

SE L'UTENTE ALLEGA UN'IMMAGINE (mockup, screenshot, wireframe):
- Analizza la struttura visiva: layout, gerarchia tipografica, spaziatura, grid/flex.
- Riproduci fedelmente la struttura e le proporzioni del layout.
- Adatta COLORI e FONT al design system del sito (usa var(--...) dalle CSS vars sotto).
- Genera il blocco che più si avvicina al design mostrato.
${styleMemoryBlock}
DESIGN SYSTEM (CSS custom properties del sito — usa var(--...) per colori e font):
\`\`\`css
${designTokensCss || ':root { --color-accent: #2563eb; --color-bg: #fff; --color-text: #1a1a1a; --font-body: sans-serif; --font-heading: sans-serif; }'}
\`\`\`

${buildContextPrompt(context)}`

  type TextBlock = { type: 'text'; text: string }
  type ImageBlock = { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

  const msgContent: (TextBlock | ImageBlock)[] = []
  if (imageBase64) {
    msgContent.push({
      type: 'image',
      source: { type: 'base64', media_type: imageBase64.media_type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: imageBase64.data },
    })
  }
  msgContent.push({ type: 'text', text: userMessage })

  // Use Sonnet when image is attached (better vision). Otherwise Haiku is fast + cheap.
  // Style memory or previous style doesn't require Sonnet.
  const model = imageBase64 ? 'claude-sonnet-4-5-20250929' : 'claude-haiku-4-5-20251001'

  const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      tools: [COMPONENT_TOOL],
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: msgContent.length === 1 && !imageBase64 ? userMessage : msgContent }],
    }),
  }, 'component')

  if (!res.ok) throw new Error(`Component agent error: ${await res.text()}`)
  const data = await res.json()
  const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
  if (!toolUse) throw new Error('No tool use in component agent response')

  const inp = toolUse.input as { html: string; summary: string }
  // Strip blank lines for consistency with html-agent output
  inp.html = inp.html.replace(/\n{3,}/g, '\n\n')
  return { html: inp.html, summary: inp.summary, usage: data.usage }
}
