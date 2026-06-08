import { callClaude } from './config'
import { fetchWithRetry } from './fetch-retry'
import type { DesignOutput } from './design-agent'
import type { ProjectRules } from './project-rules'
import { formatRulesForAgent } from './project-rules'

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
  projectRules?: ProjectRules
  /** Running design diary updated after every turn. Captures decisions, corrections, structure. */
  sessionMemory?: string
}

export function buildContextPrompt(context: ProjectContext): string {
  return buildRichContextPrompt({ context })
}

/**
 * Builds the full project context prompt including Design System, pages, blog tone.
 * The richer the input, the better the agent's output quality.
 */
export function buildRichContextPrompt({ context, pages, designSystem, sharedCss, blogPosts, projectRules, sessionMemory }: RichContext): string {
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

  // ── Session Memory (design diary — always read before pages) ──
  if (sessionMemory && sessionMemory.trim().length > 50) {
    parts.push(`\n## MEMORIA DI SESSIONE (decisioni prese, correzioni, struttura — leggi sempre):`)
    parts.push(sessionMemory.trim())
  }

  // ── Pages list ──
  if (pages && pages.length > 0) {
    parts.push(`\n## PAGINE ESISTENTI (${pages.length} pagine):`)
    parts.push(pages.map(p => `- /${p.slug === 'home' ? '' : p.slug} → "${p.name}"`).join('\n'))
  }

  // ── Design System ──
  // ⚠️ When the user edits the Design System in the platform UI, these values
  // are the AUTHORITATIVE source. The agent MUST use them on all new content.
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
      parts.push(`\n## DESIGN SYSTEM ATTUALE — VALORI AUTORITATIVI (usa SEMPRE questi, mai sovrascrivere):`)
      parts.push(dsLines.join('\n'))
      parts.push(`⚠️ Questi valori sono stati impostati dall'utente nel pannello Design. Non cambiarli MAI — nemmeno su create_site. Usali come fonte di verità per font, dimensioni e colori.`)
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

  // ── Project-specific rules (conventions learned from existing pages) ──
  if (projectRules) {
    const rulesText = formatRulesForAgent(projectRules)
    parts.push(`\n${rulesText}`)
  }

  return parts.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Memory Agent
// Mantiene un documento markdown vivo con: decisioni di design, correzioni
// ricevute, struttura del sito, vincoli negativi, stile/ispirazione.
// Viene aggiornato in background dopo ogni turno dell'HTML Agent.
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_MEMORY_SYSTEM = `Sei un agente che mantiene il "diario di progetto" di un sito web in costruzione.
Il diario è un documento markdown che cattura le decisioni reali prese durante la conversazione.

STRUTTURA DEL DOCUMENTO (usa solo le sezioni rilevanti, non forzarle tutte):
## Decisioni di Design
Palette colori, font scelti, stile visivo (es: minimalista, dark, rounded), layout decisi.

## Correzioni Ricevute
Cosa l'utente ha chiesto di cambiare e come è stato risolto. Formato: "problema → soluzione".

## Struttura del Sito
Pagine create ✅, in corso 🔄, da fare ❌. Sezioni principali di ogni pagina.

## Vincoli Negativi
Cose che l'utente ha detto esplicitamente di NON volere.

## Stile / Ispirazione
Riferimenti visivi menzionati (es: "stile Linear.app", "come Stripe", "minimalista").

REGOLE:
- Aggiorna SOLO se l'ultimo exchange contiene informazioni nuove o correzioni.
- Mantieni il documento CONCISO: max 700 token totali.
- Aggiorna/sovrascrivi le informazioni obsolete — non duplicarle.
- Se non ci sono nuove informazioni rilevanti, rispondi con la stringa esatta: NO_CHANGE
- Rispondi SOLO con il documento markdown aggiornato oppure NO_CHANGE. Zero testo extra.`

// ── Fase 3d: Memory consolidation ────────────────────────────────────────────

const COMPACTION_SYSTEM = `Sei un agente di compattamento memoria per un progetto web.
Ricevi un diario di progetto LUNGO e lo devi ridurre a una versione ESSENZIALE.

OBIETTIVO: distillare tutto ciò che è ancora rilevante in max 500 token.
- Tieni: decisioni di design attive, vincoli negativi, struttura pagine, correzioni chiave
- Elimina: dettagli tecnici obsoleti, iterazioni superate, discussioni risolte
- Formato: stesso markdown strutturato del documento originale
- Rispondi SOLO con il documento compattato, zero testo extra.`

/**
 * Fase 3d: Compact session memory when it grows too large.
 * Runs on Haiku (fast, cheap) — session memory rarely needs Sonnet quality.
 * Triggered automatically when messages.length > COMPACTION_THRESHOLD.
 */
export async function compactSessionMemory(
  current: string,
  apiKey: string
): Promise<string | null> {
  const COMPACTION_THRESHOLD_CHARS = 2_000  // ~500 tokens
  if (!current || current.length < COMPACTION_THRESHOLD_CHARS) return null  // already compact

  const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',  // Haiku: fast + cheap for compaction
      max_tokens: 1_000,
      system: COMPACTION_SYSTEM,
      messages: [{ role: 'user', content: `DIARIO DA COMPATTARE:\n${current}\n\nCompatta mantenendo solo le informazioni ANCORA RILEVANTI.` }],
    }),
  }, 'session-memory-compact')
  if (!res.ok) return null
  const data = await res.json()
  const text = data.content?.[0]?.text?.trim() ?? ''
  return text.length > 50 ? text : null
}

/** Returns true if session memory should be compacted before this turn. */
export function shouldCompactMemory(
  messages: { role: string }[],
  sessionMemory: string
): boolean {
  // Only compact on longer sessions (>40 messages) when memory is large
  return messages.length > 40 && (sessionMemory?.length ?? 0) > 2_000
}

/**
 * Aggiorna la session memory con le informazioni rilevanti dall'ultimo exchange.
 * Chiamato in background (non-blocking) dopo ogni risposta dell'HTML Agent.
 *
 * @param messages  ultimi 10 messaggi (sufficiente contesto senza sprecare token)
 * @param current   session memory attuale (stringa markdown, può essere vuota)
 * @param apiKey    Anthropic API key
 * @returns         documento markdown aggiornato, o null se niente è cambiato
 */
export async function runSessionMemoryAgent(
  messages: { role: string; content: string }[],
  current: string,
  apiKey: string
): Promise<string | null> {
  // Ultimi 10 messaggi — abbastanza contesto, non eccessivo
  const recentMessages = messages.slice(-10)

  // Costruisci il messaggio per l'agente
  // Tronca i messaggi dell'agente (contengono HTML/JSON verbose)
  const formattedMessages = recentMessages.map(m => {
    const isAgent = m.role === 'assistant'
    const content = isAgent ? m.content.slice(0, 600) + (m.content.length > 600 ? '…[troncato]' : '') : m.content
    return `[${m.role.toUpperCase()}]: ${content}`
  }).join('\n\n---\n\n')

  const userPrompt = `DOCUMENTO ATTUALE:
${current?.trim() || '(vuoto — primo turno del progetto)'}

ULTIMI MESSAGGI:
${formattedMessages}

Aggiorna il documento con le nuove informazioni rilevanti dall'ultimo exchange.`

  const res = await callClaude(
    'session-memory',
    SESSION_MEMORY_SYSTEM,
    [{ role: 'user', content: userPrompt }],
    [],  // no tools — risposta testo diretto
    apiKey
  )
  if (!res.ok) return null

  const data = await res.json()
  const text = data.content?.[0]?.text?.trim() ?? ''

  if (!text || text === 'NO_CHANGE' || text.length < 30) return null

  return text
}
