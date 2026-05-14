import { callClaude } from './config'

export type DesignBrief = {
  colors: {
    primary?: string
    secondary?: string
    accent?: string
    background?: string
    text?: string
    others?: string[]
  }
  fonts: {
    heading?: string
    body?: string
    others?: string[]
  }
  borderRadius?: string
  spacing?: string
  style?: string
  notes?: string
  sourceUrl: string
}

const ANALYZER_TOOLS = [
  {
    name: 'extract_design',
    description: 'Estrai il design system da HTML/CSS di un sito web.',
    input_schema: {
      type: 'object' as const,
      properties: {
        colors: {
          type: 'object',
          properties: {
            primary: { type: 'string', description: 'Colore principale HEX.' },
            secondary: { type: 'string', description: 'Colore secondario HEX.' },
            accent: { type: 'string', description: 'Colore accento HEX.' },
            background: { type: 'string', description: 'Colore sfondo HEX.' },
            text: { type: 'string', description: 'Colore testo principale HEX.' },
            others: { type: 'array', items: { type: 'string' }, description: 'Altri colori rilevanti HEX.' },
          },
        },
        fonts: {
          type: 'object',
          properties: {
            heading: { type: 'string', description: 'Font per i titoli.' },
            body: { type: 'string', description: 'Font per il testo.' },
            others: { type: 'array', items: { type: 'string' } },
          },
        },
        borderRadius: { type: 'string', description: 'Border radius predominante (es: 4px, 8px, 0px, 50px).' },
        spacing: { type: 'string', description: 'Unità di spacing base (es: 8px, 16px).' },
        style: { type: 'string', description: 'Descrizione dello stile visivo (es: minimal, luxury, bold, playful).' },
        notes: { type: 'string', description: 'Osservazioni rilevanti sul design (layout, componenti caratteristici, ecc.).' },
      },
      required: ['colors', 'fonts'],
    },
  },
]

async function fetchSiteHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; DesignAnalyzer/1.0)',
      'Accept': 'text/html',
    },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
  const html = await res.text()
  return html.slice(0, 30000) // limit to avoid token overflow
}

function extractCssFromHtml(html: string): string {
  const styles: string[] = []

  // Extract <style> tags
  const styleMatches = html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)
  for (const match of styleMatches) {
    styles.push(match[1])
  }

  // Extract inline style attributes (sample)
  const inlineMatches = html.matchAll(/style="([^"]{10,200})"/gi)
  for (const match of inlineMatches) {
    styles.push(match[1])
  }

  // Extract Google Fonts links
  const fontMatches = html.matchAll(/fonts\.googleapis\.com\/css[^"']*/gi)
  for (const match of fontMatches) {
    styles.push(`/* Google Font: ${match[0]} */`)
  }

  // Extract CSS custom properties and color/font references from full HTML
  const cssVars = html.match(/--[\w-]+:\s*[^;}{]+/g) ?? []
  styles.push(cssVars.join('\n'))

  return styles.join('\n').slice(0, 15000)
}

export async function analyzeSite(url: string, apiKey: string): Promise<DesignBrief | null> {
  try {
    const html = await fetchSiteHtml(url)
    const css = extractCssFromHtml(html)

    const system = `Sei un esperto UI designer. Analizzi HTML e CSS di siti web per estrarne il design system.
Estrai colori predominanti, font, border-radius, spacing e lo stile visivo generale.
Converti sempre i colori in HEX. Se un colore è in RGB/HSL, convertilo.
Guarda prioritariamente le variabili CSS custom (--color-*, --font-*), poi i valori più ripetuti.`

    const userMessage = `Analizza il design system di questo sito (${url}).

CSS ESTRATTO:
${css}

HTML (prime righe per contesto):
${html.slice(0, 3000)}`

    const res = await callClaude(
      'orchestrator',
      system,
      [{ role: 'user', content: userMessage }],
      ANALYZER_TOOLS,
      apiKey
    )

    if (!res.ok) return null
    const data = await res.json()
    const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
    if (!toolUse) return null

    return { ...toolUse.input, sourceUrl: url } as DesignBrief
  } catch (err) {
    console.error(`Site analyzer error for ${url}:`, err)
    return null
  }
}

export function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s,)]+/g
  return (text.match(urlRegex) ?? []).filter(url => {
    try { new URL(url); return true } catch { return false }
  })
}

export function buildInspirationPrompt(briefs: DesignBrief[]): string {
  if (briefs.length === 0) return ''
  const lines = ['## SITI DI ISPIRAZIONE (analizzati automaticamente):']
  for (const b of briefs) {
    lines.push(`\n### ${b.sourceUrl}`)
    if (b.style) lines.push(`Stile: ${b.style}`)
    if (b.colors.primary) lines.push(`Colore primario: ${b.colors.primary}`)
    if (b.colors.secondary) lines.push(`Colore secondario: ${b.colors.secondary}`)
    if (b.colors.background) lines.push(`Sfondo: ${b.colors.background}`)
    if (b.colors.text) lines.push(`Testo: ${b.colors.text}`)
    if (b.fonts.heading) lines.push(`Font heading: ${b.fonts.heading}`)
    if (b.fonts.body) lines.push(`Font body: ${b.fonts.body}`)
    if (b.borderRadius) lines.push(`Border radius: ${b.borderRadius}`)
    if (b.notes) lines.push(`Note: ${b.notes}`)
  }
  lines.push('\nIspirati a questi design ma crea qualcosa di originale e non una copia.')
  return lines.join('\n')
}
