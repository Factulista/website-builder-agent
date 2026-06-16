import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildSourcesBlock } from '../../../lib/fetch-source'

export const runtime = 'nodejs'
export const maxDuration = 300

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function getUser(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const { data: { user } } = await getSupabase().auth.getUser(auth.slice(7))
  return user
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

async function getToneOfVoiceSample(projectId: string): Promise<string> {
  try {
    const { data: posts } = await getSupabase()
      .from('blog_posts')
      .select('title, content_html')
      .eq('project_id', projectId)
      .not('content_html', 'is', null)
      .order('published_at', { ascending: false })
      .limit(3)

    if (!posts || posts.length === 0) return ''

    const samples = posts.map(p => {
      const text = stripHtml(p.content_html ?? '')
      const words = text.split(' ').slice(0, 300).join(' ')
      return `--- Articolo: "${p.title}" ---\n${words}...`
    }).join('\n\n')

    return samples
  } catch {
    return ''
  }
}

export async function POST(req: NextRequest) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'API key mancante' }, { status: 500 })

  const body = await req.json()
  const {
    topic,
    keywords = [],
    wordCount = 1200,
    paragraphCount = 4,
    h3Count = 2,
    h4Count = 0,
    flags = {},
    projectId,
    context,
    designSystem,
    sourceUrls = [],
  } = body as {
    topic: string
    keywords?: string[]
    wordCount?: number
    paragraphCount?: number
    h3Count?: number
    h4Count?: number
    flags?: Record<string, boolean>
    sourceUrls?: string[]
    projectId?: string
    context?: {
      businessName?: string
      businessType?: string
      services?: string[]
      language?: string
      targetAudience?: string
    }
    designSystem?: Record<string, { fontSize?: string; fontWeight?: string; color?: string; lineHeight?: string }>
  }

  if (!topic) return NextResponse.json({ error: 'topic richiesto' }, { status: 400 })

  const f = {
    summary:   flags.summary   ?? true,
    takeaways: flags.takeaways ?? true,
    table:     flags.table     ?? true,
    faq:       flags.faq       ?? true,
    callout:   flags.callout   ?? false,
    stats:     flags.stats     ?? false,
    cta:       flags.cta       ?? false,
  }

  const lang = context?.language ?? 'it'
  const langLabel = lang === 'es' ? 'spagnolo' : lang === 'en' ? 'inglese' : lang === 'fr' ? 'francese' : lang === 'de' ? 'tedesco' : 'italiano'
  const keywordList = keywords.filter(Boolean)
  const primaryKw = keywordList[0] ?? topic
  const secondaryKws = keywordList.slice(1)

  const businessCtx = context ? `
Contesto del sito:
- Business: ${context.businessName ?? '—'}
- Settore: ${context.businessType ?? '—'}
- Servizi: ${(context.services ?? []).join(', ') || '—'}
- Target: ${context.targetAudience ?? '—'}` : ''

  const toneOfVoice = projectId ? await getToneOfVoiceSample(projectId) : ''
  const toneSection = toneOfVoice
    ? `\n\nTONO DI VOCE — prendi spunto da questi articoli già pubblicati per replicare lo stesso stile, registro e lunghezza delle frasi:\n${toneOfVoice}`
    : ''

  // Build DS typography reference for the prompt
  const dsStyles = designSystem ? (() => {
    const fmt = (tag: string) => {
      const c = designSystem[tag]
      if (!c) return null
      const parts = []
      if (c.fontSize   && c.fontSize   !== 'inherit') parts.push(`font-size:${c.fontSize}`)
      if (c.fontWeight && c.fontWeight !== 'inherit') parts.push(`font-weight:${c.fontWeight}`)
      if (c.color      && c.color      !== 'inherit') parts.push(`color:${c.color}`)
      if (c.lineHeight && c.lineHeight !== 'inherit') parts.push(`line-height:${c.lineHeight}`)
      return parts.length ? `${tag.toUpperCase()}: ${parts.join(', ')}` : null
    }
    return ['h1','h2','h3','h4','p','li'].map(fmt).filter(Boolean).join(' | ')
  })() : ''

  // Blocks use only class names — NO inline style. CSS is handled by the platform.
  const h3Desc = h3Count > 0 ? ` — ogni H2 contiene ${h3Count} sottosezione/i H3${h4Count > 0 ? `, ogni H3 contiene ${h4Count} sottosezione/i H4` : ''}` : ''
  const structureBlocks: string[] = []
  structureBlocks.push(`<h1>[titolo con keyword primaria]</h1>`)
  structureBlocks.push(`<p>[intro: definizione chiara + keyword primaria nel primo paragrafo]</p>`)
  if (f.summary)   structureBlocks.push(`<div class="article-summary"><strong>In breve:</strong><p>[2-3 frasi che riassumono l'articolo — favorisce Google AI Overview]</p></div>`)
  if (f.takeaways) structureBlocks.push(`<div class="key-takeaways"><strong>💡 Punti chiave</strong><ul>[3-5 punti chiave, brevi e diretti]</ul></div>`)
  structureBlocks.push(`\n[${paragraphCount} sezioni H2 principali${h3Desc}, ognuna con 2-3 <p> e keyword pertinenti]`)
  if (f.table)   structureBlocks.push(`[includi almeno una <table> con intestazioni <th>]`)
  if (f.callout) structureBlocks.push(`[includi 1-2 callout: <div class="callout"><strong>📌 Da sapere:</strong> [concetto chiave]</div>]`)
  if (f.stats)   structureBlocks.push(`[includi 2-3 dati/statistiche concrete — usa <strong> per i numeri]`)
  if (f.faq)     structureBlocks.push(`<h2>Domande frequenti su [topic]</h2>\n[3-4 domande come <h3> con risposta in <p>]`)
  structureBlocks.push(`<h2>Conclusione</h2>\n<p>[sintesi con keyword primaria]</p>`)
  if (f.cta) structureBlocks.push(`<div class="cta-box"><h3>[headline CTA]</h3><p>[sottotitolo CTA]</p><a href="#">[testo bottone]</a></div>`)

  const system = `Sei un esperto copywriter, SEO specialist e GEO (Generative Engine Optimization) specialist.
Scrivi articoli di blog professionali, ottimizzati per Google e per i motori AI (ChatGPT, Perplexity, Google AI Overview).
Rispondi SEMPRE in ${langLabel}.
Rispondi SOLO con JSON valido, senza markdown o testo extra.

REGOLA ASSOLUTA — HTML SEMANTICO PURO:
- ZERO attributi style="" in qualsiasi tag. Mai. Nemmeno uno.
- ZERO attributi font, color, size, face, class con valori di stile.
- Usa SOLO tag semantici: h1 h2 h3 h4 p ul ol li strong em blockquote table thead tbody tr th td div.
- Per i blocchi speciali usa SOLO l'attributo class (es. class="article-summary") senza style.
- Il Design System CSS della piattaforma gestisce TUTTO: font, colori, dimensioni, spaziatura.
- Un articolo con style="" inline è SBAGLIATO e inutilizzabile.
${businessCtx}${toneSection}`

  // Fetch reference sources (links the user provided) — capped to keep tokens in check
  const sourcesBlock = await buildSourcesBlock(Array.isArray(sourceUrls) ? sourceUrls : [])

  const userMessage = `Scrivi un articolo di blog su: "${topic}"${sourcesBlock ? `

MATERIALE DI RIFERIMENTO (usa questi contenuti come fonte per essere preciso e accurato; NON copiare letteralmente, rielabora con parole tue; cita dati/fatti reali presenti qui):
${sourcesBlock}
` : ''}

Keyword primaria: "${primaryKw}"
${secondaryKws.length > 0 ? `Keyword secondarie: ${secondaryKws.map(k => `"${k}"`).join(', ')}` : ''}

PARAMETRI OBBLIGATORI:
- Lunghezza esatta: ${wordCount} parole (±5%) — conta le parole nel testo visibile
- Sezioni H2 principali: ${paragraphCount} (oltre a FAQ e Conclusione)
- Sottosezioni H3 per ogni H2: ${h3Count > 0 ? h3Count : 'nessuna'}
- Sottosezioni H4 per ogni H3: ${h4Count > 0 ? h4Count : 'nessuna'}
- Lingua: ${langLabel}
${dsStyles ? `
STILI TIPOGRAFICI DEL SITO (Design System) — usa questi tag con la consapevolezza del loro peso visivo:
${dsStyles}
Suggerimento struttura: H1 = titolo principale prominente, H2 = sezioni maggiori, H3 = sottosezioni, H4 = dettagli, P = corpo del testo` : ''}

STRUTTURA HTML da seguire nell'ordine:
${structureBlocks.join('\n')}

REGOLE SEO:
- Keyword primaria: in H1, primo paragrafo, almeno 2 H2, conclusione
- Keyword secondarie: distribuite (1-2 volte ciascuna, naturali)
- Densità keyword primaria: 1-2%
- <strong> per concetti chiave (2-3 per sezione max)
${!f.table ? '' : '- Includi almeno 1 <table> con intestazioni <th>'}

REGOLE GEO (AI Search Optimization):
- Primo paragrafo: definizione diretta ("X è...", "X serve per...")
- Usa frasi brevi e dirette per rispondere a domande implicite
${f.faq ? '- FAQ: risposte complete e autonome, leggibili da AI senza contesto' : ''}
${f.stats ? '- Includi almeno 2-3 dati numerici concreti' : ''}

Restituisci SOLO questo JSON (nessun testo fuori dal JSON):
{
  "title": "H1 con keyword primaria, max 70 caratteri",
  "slug": "slug-kebab-case-con-keyword",
  "seo_title": "SEO title max 60 caratteri con keyword primaria — SOLO testo, NO emoji",
  "seo_description": "meta description 150-160 caratteri con keyword e CTA",
  "excerpt": "riassunto 1-2 frasi max 200 caratteri",
  "content_html": "HTML COMPLETO seguendo la struttura sopra — ${wordCount} parole"
}

IMPORTANTE: NON includere campi "categories", "tags" nel JSON. Solo i campi elencati sopra.
Il campo "title" NON deve contenere emoji o simboli speciali — solo testo puro.`

  // Streaming response
  const encoder = new TextEncoder()
  const customReadable = new ReadableStream({
    async start(controller) {
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 16000,
            stream: true,
            system,
            messages: [{ role: 'user', content: userMessage }],
          }),
        })

        if (!response.ok) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: `API error: ${response.status}` })}\n\n`))
          controller.close()
          return
        }

        const reader = response.body?.getReader()
        if (!reader) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: 'No reader' })}\n\n`))
          controller.close()
          return
        }

        let fullText = ''
        let currentJson = ''
        let jsonStarted = false

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = new TextDecoder().decode(value)
          const lines = chunk.split('\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))
                if (data.type === 'content_block_delta' && data.delta.type === 'text_delta') {
                  const text = data.delta.text
                  fullText += text

                  // Try to detect if we're in the JSON part
                  if (text.includes('{')) jsonStarted = true
                  if (jsonStarted) currentJson += text

                  // Send streaming event with latest text chunk
                  controller.enqueue(encoder.encode(`event: text\ndata: ${JSON.stringify({ text })}\n\n`))
                }
              } catch (e) {
                // Silently ignore parse errors on stream lines
              }
            }
          }
        }

        // Parse final JSON + sanitize: strip any inline style/font attrs the AI smuggled in
        try {
          const jsonMatch = currentJson.match(/\{[\s\S]*\}/)
          if (!jsonMatch) throw new Error('No JSON found')
          const post = JSON.parse(jsonMatch[0])
          if (typeof post.content_html === 'string') {
            post.content_html = post.content_html
              // Remove ALL style="" attributes
              .replace(/\s*style="[^"]*"/gi, '')
              // Remove font face/size/color HTML4 attrs
              .replace(/\s*(?:face|color|size)="[^"]*"/gi, '')
              // Unwrap <font> tags
              .replace(/<font[^>]*>([\s\S]*?)<\/font>/gi, '$1')
              // Remove empty class attributes
              .replace(/\s*class=""/gi, '')
              // Fix &quot; inside remaining attrs
              .replace(/&quot;/g, '"')
          }
          controller.enqueue(encoder.encode(`event: complete\ndata: ${JSON.stringify({ post })}\n\n`))
        } catch (e) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: 'JSON parse failed' })}\n\n`))
        }

        controller.close()
      } catch (err) {
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`))
        controller.close()
      }
    },
  })

  return new NextResponse(customReadable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
