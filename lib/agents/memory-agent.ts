import { callClaude } from './config'
import type { DesignOutput } from './design-agent'

export type ProjectContext = {
  businessName?: string
  businessType?: string
  location?: string
  targetAudience?: string
  toneOfVoice?: string
  brandColors?: string[]
  brandFonts?: string[]
  uniqueValue?: string
  services?: string[]
  contactInfo?: { phone?: string; email?: string; address?: string }
  language?: string
  updatedAt?: string
  /** Design generato dal Design agent — riusato su add-page per coerenza e risparmio token */
  design?: DesignOutput
  /** URL del sito di ispirazione dall'ultima richiesta con URL — usato per abbinare gli screenshot */
  lastInspirationUrl?: string
}

const MEMORY_TOOLS = [
  {
    name: 'update_context',
    description: 'Aggiorna il contesto del progetto con le informazioni estratte dalla conversazione.',
    input_schema: {
      type: 'object' as const,
      properties: {
        businessName: { type: 'string' },
        businessType: { type: 'string', description: 'Es: ristorante, studio legale, e-commerce, agenzia web...' },
        location: { type: 'string' },
        targetAudience: { type: 'string' },
        toneOfVoice: { type: 'string', description: 'Es: formale, amichevole, tecnico, luxury...' },
        brandColors: { type: 'array', items: { type: 'string' }, description: 'Colori HEX o nomi.' },
        brandFonts: { type: 'array', items: { type: 'string' } },
        uniqueValue: { type: 'string', description: 'Proposta di valore unica del business.' },
        services: { type: 'array', items: { type: 'string' } },
        contactInfo: {
          type: 'object',
          properties: {
            phone: { type: 'string' },
            email: { type: 'string' },
            address: { type: 'string' },
          },
        },
      },
    },
  },
]

export async function runMemoryAgent(
  messages: { role: string; content: string }[],
  currentContext: ProjectContext,
  apiKey: string
): Promise<ProjectContext | null> {
  const system = `Sei un agente di memoria. Estrai informazioni sul business dell'utente dalla conversazione e aggiorna il contesto del progetto.

CONTESTO ATTUALE:
${JSON.stringify(currentContext, null, 2)}

REGOLE:
- Estrai solo informazioni esplicitamente menzionate dall'utente.
- Non inventare o dedurre informazioni non dette.
- Aggiorna solo i campi dove hai nuove informazioni.
- Se non ci sono nuove informazioni, chiama update_context con un oggetto vuoto {}.`

  const res = await callClaude('memory', system, messages, MEMORY_TOOLS, apiKey)
  if (!res.ok) return null

  const data = await res.json()
  const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
  if (!toolUse) return null

  const extracted = toolUse.input as Partial<ProjectContext>
  const hasNewInfo = Object.keys(extracted).length > 0

  if (!hasNewInfo) return null

  return {
    ...currentContext,
    ...extracted,
    updatedAt: new Date().toISOString(),
  }
}

export type RichContext = {
  context: ProjectContext
  pages?: Array<{ slug: string; name: string; html: string }>
  designSystem?: Record<string, { fontSize?: string; fontWeight?: string; color?: string; lineHeight?: string; fontFamily?: string }>
  sharedCss?: string
  blogPosts?: Array<{ title: string; content_html: string }>
}

export function buildContextPrompt(context: ProjectContext): string {
  return buildRichContextPrompt({ context })
}

/**
 * Builds the full project context prompt including Design System, pages, blog tone.
 * The richer the input, the better the agent's output quality.
 */
export function buildRichContextPrompt({ context, pages, designSystem, sharedCss, blogPosts }: RichContext): string {
  if (!context || Object.keys(context).length === 0) return ''

  const parts: string[] = ['## CONTESTO PROGETTO (usa sempre queste informazioni):']

  // ── Business info ──
  if (context.businessName) parts.push(`- Nome: ${context.businessName}`)
  if (context.businessType) parts.push(`- Settore: ${context.businessType}`)
  if (context.language) parts.push(`- Lingua sito: ${context.language} — scrivi SEMPRE in questa lingua`)
  if (context.location) parts.push(`- Location: ${context.location}`)
  if (context.targetAudience) parts.push(`- Target: ${context.targetAudience}`)
  if (context.toneOfVoice) parts.push(`- Tone of voice: ${context.toneOfVoice}`)
  if (context.uniqueValue) parts.push(`- Proposta di valore: ${context.uniqueValue}`)
  if (context.brandColors?.length) parts.push(`- Colori brand: ${context.brandColors.join(', ')}`)
  if (context.brandFonts?.length) parts.push(`- Font brand: ${context.brandFonts.join(', ')}`)
  if (context.services?.length) parts.push(`- Servizi: ${context.services.join(', ')}`)
  if (context.contactInfo) {
    const ci = context.contactInfo
    if (ci.phone) parts.push(`- Telefono: ${ci.phone}`)
    if (ci.email) parts.push(`- Email: ${ci.email}`)
    if (ci.address) parts.push(`- Indirizzo: ${ci.address}`)
  }

  // ── Logo ──
  const logo = context.design?.tokens?.logo
  if (logo) {
    if (logo.type === 'text') {
      parts.push(`- Logo: testo "${logo.content}", colore ${logo.color}${logo.accentChar ? `, accent su "${logo.accentChar}"` : ''}`)
    } else if (logo.type === 'svg') {
      parts.push(`- Logo: SVG inline, colore fill ${logo.color}`)
    } else if (logo.type === 'img') {
      parts.push(`- Logo: immagine URL "${logo.content}"`)
    }
  }

  // ── Pages list ──
  if (pages && pages.length > 0) {
    parts.push(`\n## PAGINE ESISTENTI (${pages.length} pagine):`)
    parts.push(pages.map(p => `- /${p.slug === 'home' ? '' : p.slug} → "${p.name}"`).join('\n'))
  }

  // ── Design System ──
  if (designSystem) {
    const ds = designSystem
    const fmt = (tag: string) => {
      const c = ds[tag]
      if (!c) return null
      const p = []
      if (c.fontFamily && c.fontFamily !== 'inherit') p.push(`font: ${c.fontFamily}`)
      if (c.fontSize   && c.fontSize   !== 'inherit') p.push(`size: ${c.fontSize}`)
      if (c.fontWeight && c.fontWeight !== 'inherit') p.push(`weight: ${c.fontWeight}`)
      if (c.color      && c.color      !== 'inherit') p.push(`color: ${c.color}`)
      if (c.lineHeight && c.lineHeight !== 'inherit') p.push(`lh: ${c.lineHeight}`)
      return p.length ? `${tag.toUpperCase()}: ${p.join(' | ')}` : null
    }
    const dsLines = ['h1','h2','h3','h4','p','li','a'].map(fmt).filter(Boolean)
    if (dsLines.length > 0) {
      parts.push(`\n## DESIGN SYSTEM ATTUALE (rispetta sempre questi valori tipografici):`)
      parts.push(dsLines.join('\n'))
    }
  }

  // ── Shared CSS summary (extract :root vars only to save tokens) ──
  if (sharedCss) {
    const rootMatch = sharedCss.match(/:root\s*\{([^}]+)\}/)
    if (rootMatch) {
      parts.push(`\n## CSS VARIABILI GLOBALI (:root):\n:root {\n${rootMatch[1].trim().slice(0, 800)}\n}`)
    }
  }

  // ── Blog tone of voice (first 2 posts, 300 chars each) ──
  if (blogPosts && blogPosts.length > 0) {
    const samples = blogPosts.slice(0, 2).map(b => {
      const text = b.content_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
      return `"${b.title}": ${text}…`
    }).join('\n')
    parts.push(`\n## STILE EDITORIALE (articoli già pubblicati — replica questo tone of voice):`)
    parts.push(samples)
  }

  return parts.join('\n')
}
