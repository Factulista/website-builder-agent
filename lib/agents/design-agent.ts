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
  apiKey: string
): Promise<DesignOutput> {
  const system = `Sei un UI designer esperto. Crei design system coerenti e moderni per siti web.

PIANO DEL SITO:
Business: ${plan.businessType}
${plan.targetAudience ? `Target: ${plan.targetAudience}` : ''}
Sezioni usate: ${[...new Set(plan.pages.flatMap(p => p.sections))].join(', ')}

REGOLE:
- Scegli colori appropriati al tipo di business (ristorante → caldi, tech → freddi, luxury → scuri ecc.).
- Font leggibili: usa sempre Google Fonts disponibili.
- CSS deve includere: variabili CSS custom, reset base, stili per navbar, hero, features, cta, footer, cards, buttons, forms.
- Contrasto colori: almeno 4.5:1 per testo su sfondo (WCAG AA).
- Design mobile-first con media queries.
- Stile moderno: usa gradients, box-shadow, border-radius appropriati al brand.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      system,
      tools: DESIGN_TOOLS,
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: userRequest }],
    }),
  })

  if (!res.ok) throw new Error(`Design Agent API error: ${await res.text()}`)
  const data = await res.json()
  const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
  if (!toolUse) throw new Error('No tool use in Design response')
  return toolUse.input as DesignOutput
}
