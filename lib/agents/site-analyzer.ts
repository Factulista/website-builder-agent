import { callClaude, callClaudeMultimodal, type ContentBlock } from './config'

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

/** Extracts image URLs from chat message content (lines like "Immagine allegata: https://...") */
export function extractImageUrls(text: string): string[] {
  const matches = [...text.matchAll(/Immagine allegata:\s*(https?:\/\/[^\s\n]+)/g)]
  return matches.map(m => m[1])
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; media_type: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return null
    const buffer = await res.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const ct = res.headers.get('content-type') || 'image/jpeg'
    const media_type = ct.split(';')[0].trim()
    // Only allow Anthropic-supported types
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!allowed.includes(media_type)) return null
    // Limit to ~4MB base64 (3MB raw) to stay within API limits
    if (base64.length > 4_000_000) return null
    return { data: base64, media_type }
  } catch {
    return null
  }
}

/** analyzeScreenshots — uses Claude Vision to extract a detailed DesignBrief from screenshots.
 *  Image URLs should be publicly accessible (e.g. from Supabase storage). */
export async function analyzeScreenshots(imageUrls: string[], apiKey: string): Promise<DesignBrief | null> {
  if (imageUrls.length === 0) return null

  const fetched = await Promise.all(imageUrls.map(fetchImageAsBase64))
  const validImages = fetched.filter((img): img is NonNullable<typeof img> => img !== null)
  if (validImages.length === 0) return null

  // Build multimodal content: images first, then the instruction text
  const content: ContentBlock[] = [
    ...validImages.map(img => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: img.media_type, data: img.data },
    })),
    {
      type: 'text' as const,
      text: `Sei un esperto UI designer e analista visivo. Guarda questi screenshot di un sito web e analizzane il design system in dettaglio.

Estrai con precisione:
- Colori: primario, secondario, accent, sfondo, testo (in HEX)
- Font: per i titoli e per il corpo del testo (nome esatto del font se visibile)
- Border radius: dei bottoni, card, input (in px)
- Stile delle ombre: offset, blur, colore (es: "3px 3px 0 #000", "0 4px 20px rgba(0,0,0,0.1)")
- Stile generale: es. neo-brutalist, minimal, luxury, glassmorphism, corporate, playful
- Layout hero: è centrato? immagine a destra? video in background?
- Note rilevanti: elementi caratteristici, pattern decorativi, uso di gradienti`,
    },
  ]

  const system = `Sei un esperto UI designer. Analizza screenshot di siti web e estrai il design system con precisione assoluta.
Converti sempre i colori in HEX. Se un colore è rgba/hsl, convertilo. Sii specifico sulle ombre e border-radius.`

  // Use claude-3-5-sonnet for best vision accuracy on design analysis
  const VISION_MODEL = 'claude-3-5-sonnet-20241022'

  try {
    const res = await callClaudeMultimodal(VISION_MODEL, system, content, ANALYZER_TOOLS, apiKey)
    if (!res.ok) {
      console.error('[analyzeScreenshots] API error:', res.status)
      return null
    }
    const data = await res.json()
    const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
    if (!toolUse) return null
    return { ...toolUse.input, sourceUrl: '' } as DesignBrief
  } catch (err) {
    console.error('[analyzeScreenshots] error:', err)
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
