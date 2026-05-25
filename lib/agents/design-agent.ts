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
            logo: {
              type: 'object',
              description: 'Definizione del logo da usare in tutte le navbar del sito.',
              properties: {
                type: {
                  type: 'string',
                  enum: ['text', 'svg', 'img'],
                  description: '"text" = testo stilizzato (default), "svg" = SVG inline semplice, "img" = URL immagine.',
                },
                content: {
                  type: 'string',
                  description: 'Per type=text: il nome del brand. Per type=svg: il markup SVG completo (<svg>…</svg>). Per type=img: l\'URL dell\'immagine.',
                },
                color: {
                  type: 'string',
                  description: 'Colore principale del logo HEX — usato come fill per SVG o per colorare il testo. Deve essere coerente con la palette (primary o text o white).',
                },
                accentChar: {
                  type: 'string',
                  description: 'Solo per type=text: carattere o parola da colorare con il colore accent (es: "." o "AI" o la prima lettera). Opzionale.',
                },
              },
              required: ['type', 'content', 'color'],
            },
          },
          required: ['colors', 'fonts', 'logo'],
        },
        css: { type: 'string', description: 'SOLO (1) blocco :root con le CSS custom properties dei token e (2) reset base (box-sizing, margin/padding 0). NON stili di componenti — li scrive l\'HTML agent.' },
        googleFontsUrl: { type: 'string', description: 'URL Google Fonts per i font scelti.' },
        summary: { type: 'string' },
      },
      required: ['tokens', 'css', 'summary'],
    },
  },
]

export type LogoDefinition = {
  type: 'text' | 'svg' | 'img'
  content: string   // brand name | SVG markup | image URL
  color: string     // HEX — fill for SVG, text color for text logos
  accentChar?: string  // optional char to highlight with accent color (text logos only)
}

export type DesignTokens = {
  colors: { primary: string; secondary: string; accent?: string; background: string; surface?: string; text: string; textMuted?: string }
  fonts: { heading: string; body: string }
  borderRadius?: string
  spacing?: string
  logo?: LogoDefinition
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

REGOLE PALETTE:
- Se il contesto ha colori brand, usali come base della palette.
- Se il contesto ha font brand, usali.
- Altrimenti scegli colori e font appropriati al tipo di business.
- Contrasto colori: almeno 4.5:1 (WCAG AA).

REGOLE LOGO — IMPORTANTI:
- Genera SEMPRE un campo tokens.logo. È obbligatorio.
- type="text" è il default: usa il nome del brand come content.
  - color: scegli tra il colore primario, bianco o nero in base al contrasto con la navbar.
  - accentChar: puoi colorare con l'accent un carattere significativo (es: "." finale, prima lettera, sigla).
- type="svg": solo se puoi generare un'icona SVG semplice e pertinente al business (es: casetta per immobiliare, ingranaggio per tech). Mantienila sotto 200 caratteri. Il fill deve usare il campo color.
- type="img": solo se l'utente ha fornito un URL immagine esplicito nella richiesta.
- Il logo deve essere COERENTE con la palette: il campo color deve essere un valore già presente in colors.

OUTPUT CSS — REGOLA CRITICA:
Il campo "css" deve contenere ESCLUSIVAMENTE:
1. Il blocco :root { } con tutte le CSS custom properties (--color-primary, --color-bg, --font-heading, --radius, --spacing, ecc.)
2. Il reset base: *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
3. body { font-family, background-color, color }
NON aggiungere stili per button, nav, card, section, hero o altri componenti. L'HTML agent li scrive da solo usando le variabili CSS.`

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await callClaude('design', system, [{ role: 'user', content: userRequest }], DESIGN_TOOLS, apiKey)

    if (!res.ok) throw new Error(`Design Agent API error: ${await res.text()}`)
    const data = await res.json()

    if (data.stop_reason === 'max_tokens') {
      if (attempt < 2) { await new Promise(r => setTimeout(r, 1500)); continue }
      throw new Error('Design agent: risposta troncata dopo max_tokens')
    }

    const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
    if (!toolUse || !toolUse.input?.tokens) {
      if (attempt < 2) { await new Promise(r => setTimeout(r, 1500)); continue }
      throw new Error('Design agent: nessun design valido generato')
    }

    return toolUse.input as DesignOutput
  }

  throw new Error('Design agent: troppi tentativi falliti')
}

const UPDATE_CSS_TOOL = [
  {
    name: 'update_css',
    description: 'Aggiorna il CSS condiviso del sito. Restituisce il CSS completo modificato.',
    input_schema: {
      type: 'object' as const,
      properties: {
        css: { type: 'string', description: 'Il CSS completo e aggiornato del sito. Deve contenere tutto il CSS originale con solo le modifiche richieste applicate.' },
        summary: { type: 'string', description: 'Breve descrizione di cosa è stato modificato.' },
      },
      required: ['css', 'summary'],
    },
  },
]

export async function runDesignAgentUpdate(
  userRequest: string,
  currentCss: string,
  apiKey: string,
  context: ProjectContext = {}
): Promise<{ css: string; summary: string }> {
  const system = `Sei un esperto CSS engineer. Modifichi chirurgicamente il CSS di siti web esistenti.

${buildContextPrompt(context)}

REGOLE OPERATIVE:
- Ricevi il CSS completo del sito e restituisci il CSS COMPLETO aggiornato tramite update_css.
- Modifica SOLO ciò che l'utente chiede — non toccare struttura, font, spacing o altri valori non menzionati.
- Mantieni intatta tutta la struttura CSS: @import Google Fonts, :root{}, reset, componenti, media queries.
- Per modifiche colore: aggiorna le variabili in :root{} (es: --color-primary, --color-accent) — propagano automaticamente. Poi cerca e sostituisci anche le eventuali occorrenze hardcoded dello stesso colore nel resto del CSS.
- Se l'utente cita "il colore del logo", "il blu del logo" o simili: usa il valore HEX del logo dal CONTESTO PROGETTO.
- Contrasto minimo WCAG AA: testo < 18px → ratio 4.5:1, testo grande → ratio 3:1. Se la modifica richiesta viola il contrasto, aggiusta il tono.
- Non aggiungere commenti, spiegazioni o proprietà non esistenti — CSS puro, struttura invariata.`

  const res = await callClaude(
    'design',
    system,
    [{ role: 'user', content: `Richiesta: ${userRequest}\n\nCSS ATTUALE DEL SITO:\n${currentCss}` }],
    UPDATE_CSS_TOOL,
    apiKey
  )

  if (!res.ok) throw new Error(`Design Update error: ${await res.text()}`)
  const data = await res.json()
  const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
  if (!toolUse) throw new Error('No tool use in Design Update response')

  const result = toolUse.input as { css: string; summary: string }
  return { css: result.css, summary: result.summary }
}
