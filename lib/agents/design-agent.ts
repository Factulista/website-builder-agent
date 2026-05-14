import { callClaude } from './config'
import { DESIGN_KNOWLEDGE } from './knowledge/design'
import { buildContextPrompt, type ProjectContext } from './memory-agent'
import { buildInspirationPrompt, type DesignBrief } from './site-analyzer'
import type { SitePlan } from './planner'

const DESIGN_TOOLS = [
  {
    name: 'generate_design',
    description: 'Genera i design tokens e il CSS per il sito.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tokens: {
          type: 'object',
          properties: {
            colors: {
              type: 'object',
              properties: {
                primary: { type: 'string', description: 'Colore primario HEX.' },
                secondary: { type: 'string', description: 'Colore secondario HEX.' },
                accent: { type: 'string', description: 'Colore accento HEX.' },
                background: { type: 'string', description: 'Colore sfondo HEX.' },
                surface: { type: 'string', description: 'Colore card/superficie HEX.' },
                text: { type: 'string', description: 'Colore testo principale HEX.' },
                textMuted: { type: 'string', description: 'Colore testo secondario HEX.' },
              },
              required: ['primary', 'secondary', 'background', 'text'],
            },
            fonts: {
              type: 'object',
              properties: {
                heading: { type: 'string', description: 'Font per titoli (Google Fonts name).' },
                body: { type: 'string', description: 'Font per testo (Google Fonts name).' },
              },
              required: ['heading', 'body'],
            },
            borderRadius: { type: 'string', description: 'Border radius base (es: 8px, 4px, 0px).' },
            spacing: { type: 'string', description: 'Spacing base (es: 16px).' },
          },
          required: ['colors', 'fonts'],
        },
        css: { type: 'string', description: 'CSS completo con variabili CSS, reset, e stili per tutti i componenti usati nel piano.' },
        googleFontsUrl: { type: 'string', description: 'URL Google Fonts per i font scelti.' },
        summary: { type: 'string' },
      },
      required: ['tokens', 'css', 'summary'],
    },
  },
]

export type DesignTokens = {
  colors: { primary: string; secondary: string; accent?: string; background: string; surface?: string; text: string; textMuted?: string }
  fonts: { heading: string; body: string }
  borderRadius?: string
  spacing?: string
}

export type DesignOutput = {
  tokens: DesignTokens
  css: string
  googleFontsUrl?: string
  summary: string
}

export async function runDesignAgent(
  userRequest: string,
  plan: SitePlan,
  apiKey: string,
  context: ProjectContext = {},
  inspirationBriefs: DesignBrief[] = []
): Promise<DesignOutput> {
  const system = `Sei un UI designer esperto. Crei design system coerenti e moderni per siti web.

${DESIGN_KNOWLEDGE}

${buildContextPrompt(context)}

${buildInspirationPrompt(inspirationBriefs)}

PIANO DEL SITO:
Business: ${plan.businessType}
${plan.targetAudience ? `Target: ${plan.targetAudience}` : ''}
Sezioni usate: ${[...new Set(plan.pages.flatMap(p => p.sections))].join(', ')}

REGOLE:
- Se il contesto ha colori brand, usali come base della palette.
- Se il contesto ha font brand, usali.
- Altrimenti scegli colori e font appropriati al tipo di business.
- CSS deve includere: variabili CSS custom, reset base, stili per tutte le sezioni del piano.
- Contrasto colori: almeno 4.5:1 (WCAG AA).
- Design mobile-first con media queries.`

  const res = await callClaude('design', system, [{ role: 'user', content: userRequest }], DESIGN_TOOLS, apiKey)

  if (!res.ok) throw new Error(`Design Agent API error: ${await res.text()}`)
  const data = await res.json()
  const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
  if (!toolUse) throw new Error('No tool use in Design response')
  return toolUse.input as DesignOutput
}

type Page = { slug: string; name: string; html: string }

const DESIGN_UPDATE_TOOLS = [
  {
    name: 'update_design',
    description: 'Aggiorna il design di tutte le pagine del sito con find/replace CSS mirati.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pages: {
          type: 'array',
          items: {
            type: 'object',
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
            },
            required: ['pageSlug', 'edits'],
          },
        },
        summary: { type: 'string' },
      },
      required: ['pages', 'summary'],
    },
  },
]

export async function runDesignAgentUpdate(
  userRequest: string,
  pages: Page[],
  apiKey: string,
  context: ProjectContext = {}
): Promise<{ pages: Page[]; summary: string }> {
  const pagesContext = pages.map(p => `=== ${p.slug} ===\n${p.html.slice(0, 3000)}`).join('\n\n')

  const system = `Sei un UI designer esperto. Aggiorni il design di siti web esistenti tramite find/replace CSS mirati.

${DESIGN_KNOWLEDGE}

${buildContextPrompt(context)}

REGOLE:
- Usa update_design con find/replace precisi sullo stile CSS esistente.
- Applica le modifiche a TUTTE le pagine in modo coerente.
- Modifica solo CSS (colori, font, border-radius, spacing) — non il contenuto HTML.
- I find devono essere stringhe ESATTE presenti nell'HTML.`

  const res = await callClaude(
    'design',
    system,
    [{ role: 'user', content: `Richiesta: ${userRequest}\n\nPAGINE ATTUALI:\n${pagesContext}` }],
    DESIGN_UPDATE_TOOLS,
    apiKey
  )

  if (!res.ok) throw new Error(`Design Update error: ${await res.text()}`)
  const data = await res.json()
  const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
  if (!toolUse) throw new Error('No tool use in Design Update response')

  const result = toolUse.input as { pages: { pageSlug: string; edits: { find: string; replace: string }[] }[]; summary: string }

  const updatedPages = pages.map(page => {
    const patch = result.pages?.find(p => p.pageSlug === page.slug)
    if (!patch) return page
    let html = page.html
    for (const edit of patch.edits) {
      if (html.includes(edit.find)) html = html.replace(edit.find, edit.replace)
    }
    return { ...page, html }
  })

  return { pages: updatedPages, summary: result.summary }
}
