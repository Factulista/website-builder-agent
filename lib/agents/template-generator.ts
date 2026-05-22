import { callClaude } from './config'
import type { DesignBrief } from './site-analyzer'

export type GeneratedTemplate = {
  name: string
  sector: string
  keywords: string[]
  html: string
  sourceUrl?: string
}

const GENERATOR_TOOLS = [
  {
    name: 'generate_template',
    description: 'Genera un template HTML completo con placeholder {{key}} per i contenuti testuali.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Nome descrittivo del template (es: "Ristorante Elegante - Dark").' },
        sector: { type: 'string', description: 'Settore di business (es: "Ristorazione", "Tech", "Salute", "Moda").' },
        keywords: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 1,
          description: 'Esattamente 1 keyword in inglese che identifica il tipo di business (es: "restaurant", "hotel", "agency", "clinic", "ecommerce").',
        },
        html: {
          type: 'string',
          description: 'HTML completo della pagina con placeholder {{key}} per tutti i testi. Deve includere <head> con CSS inline, nav, hero, sezione features/servizi, CTA, footer.',
        },
      },
      required: ['name', 'sector', 'keywords', 'html'],
    },
  },
]

function buildDesignContext(brief: DesignBrief): string {
  const lines: string[] = ['## DESIGN SYSTEM DA RISPETTARE:']
  if (brief.style) lines.push(`Stile: ${brief.style}`)
  if (brief.colors.primary) lines.push(`Colore primario: ${brief.colors.primary}`)
  if (brief.colors.secondary) lines.push(`Colore secondario: ${brief.colors.secondary}`)
  if (brief.colors.accent) lines.push(`Colore accent: ${brief.colors.accent}`)
  if (brief.colors.background) lines.push(`Sfondo: ${brief.colors.background}`)
  if (brief.colors.text) lines.push(`Testo: ${brief.colors.text}`)
  if (brief.colors.others?.length) lines.push(`Altri colori: ${brief.colors.others.join(', ')}`)
  if (brief.fonts.heading) lines.push(`Font titoli: ${brief.fonts.heading}`)
  if (brief.fonts.body) lines.push(`Font testo: ${brief.fonts.body}`)
  if (brief.borderRadius) lines.push(`Border radius bottoni/input: ${brief.borderRadius}`)
  if (brief.spacing) lines.push(`Spacing base: ${brief.spacing}`)
  if (brief.notes) lines.push(`Note design: ${brief.notes}`)
  return lines.join('\n')
}

/** Generates a complete HTML template (with {{placeholder}} keys) inspired by the given design brief.
 *  The template is ~15-25KB and covers: nav, hero, features, CTA, footer. */
export async function generateTemplate(
  brief: DesignBrief,
  userRequest: string,
  apiKey: string
): Promise<GeneratedTemplate | null> {
  const designContext = buildDesignContext(brief)

  const system = `Sei un esperto front-end developer e designer. Generi template HTML completi per siti web aziendali.

REGOLE FONDAMENTALI:
1. DEVI usare i colori e font del design system fornito — non inventare altri colori.
2. Tutto il CSS è inline nel <style> tag. Usa variabili CSS (--primary, --accent, ecc).
3. Usa PLACEHOLDER {{key}} per TUTTI i testi: titoli, descrizioni, CTA, footer. MAI testi fissi.
4. I placeholder seguono questo pattern: {{brand_name}}, {{hero_title}}, {{hero_subtitle}}, {{cta_text}}, {{feature_1_title}}, {{feature_1_desc}}, {{seo_title}}, {{seo_description}}, {{footer_copy}}, ecc.
5. Il template deve essere COMPLETO: head con meta SEO, nav responsive con hamburger mobile, hero, sezione features (3-4 elementi), sezione CTA, footer.
6. Il design deve essere FEDELE allo stile fornito (colori, border-radius, ombre, font).
7. Usa Google Fonts per i font specificati con @import nel CSS.
8. Il template deve funzionare standalone — nessuna dipendenza esterna tranne Google Fonts e icone SVG inline.
9. Lunghezza HTML: almeno 400 righe. Qualità professionale.
10. Le immagini hero e sezioni usano background-color con {{primary_color}} o gradient, oppure placeholder SVG inline.
11. Il campo keywords deve contenere ESATTAMENTE 1 keyword in inglese (es: "restaurant", "hotel", "clinic", "agency"). MAI più di una.`

  const userMessage = `${designContext}

## RICHIESTA UTENTE:
${userRequest}

Genera un template HTML professionale e completo che rispetti esattamente questo design system.
Il template deve essere adatto a questo tipo di business e includere tutte le sezioni standard di una landing page moderna.`

  try {
    const res = await callClaude(
      'html', // use html agent config (high maxTokens)
      system,
      [{ role: 'user', content: userMessage }],
      GENERATOR_TOOLS,
      apiKey
    )

    if (!res.ok) {
      console.error('[generateTemplate] API error:', res.status, await res.text())
      return null
    }

    const data = await res.json()
    const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
    if (!toolUse?.input) return null

    const { name, sector, keywords, html } = toolUse.input as {
      name: string
      sector: string
      keywords: string[]
      html: string
    }

    return {
      name,
      sector,
      keywords,
      html,
      sourceUrl: brief.sourceUrl || undefined,
    }
  } catch (err) {
    console.error('[generateTemplate] error:', err)
    return null
  }
}
