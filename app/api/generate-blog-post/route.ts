import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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
    flags = {},
    projectId,
    context,
  } = body as {
    topic: string
    keywords?: string[]
    wordCount?: number
    paragraphCount?: number
    flags?: Record<string, boolean>
    projectId?: string
    context?: {
      businessName?: string
      businessType?: string
      services?: string[]
      language?: string
      targetAudience?: string
    }
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

  const structureBlocks: string[] = []
  structureBlocks.push(`<h1>[titolo con keyword primaria]</h1>`)
  structureBlocks.push(`<p>[intro: definizione chiara + keyword primaria nel primo paragrafo]</p>`)
  if (f.summary) structureBlocks.push(`<div class="article-summary" style="background:#f8f9fa;border-left:4px solid #2563eb;padding:16px 20px;margin:20px 0;border-radius:0 8px 8px 0"><strong>In breve:</strong><p>[2-3 frasi che riassumono l'articolo — favorisce Google AI Overview]</p></div>`)
  if (f.takeaways) structureBlocks.push(`<div class="key-takeaways" style="background:#eff6ff;border:1px solid #bfdbfe;padding:16px 20px;margin:20px 0;border-radius:8px"><strong>💡 Punti chiave</strong><ul>[3-5 punti chiave dell'articolo, brevi e diretti]</ul></div>`)
  structureBlocks.push(`\n[${paragraphCount} sezioni H2 principali, ognuna con 2-3 <p> e keyword pertinenti]`)
  if (f.table) structureBlocks.push(`[includi almeno una <table> con intestazioni <th> in una delle sezioni dove più utile]`)
  if (f.callout) structureBlocks.push(`[includi 1-2 callout box: <div class="callout" style="background:#fef9c3;border-left:4px solid #eab308;padding:12px 16px;margin:16px 0;border-radius:0 8px 8px 0"><strong>📌 Da sapere:</strong> [concetto chiave]</div>]`)
  if (f.stats) structureBlocks.push(`[includi 2-3 dati/statistiche concrete con fonte generica es. "Secondo uno studio del 2024..." — usa <strong> per i numeri]`)
  if (f.faq) structureBlocks.push(`<h2>Domande frequenti su [topic]</h2>\n[3-4 domande come <h3> con risposta in <p> — risposte autonome e complete per AI Overview]`)
  structureBlocks.push(`<h2>Conclusione</h2>\n<p>[sintesi con keyword primaria]</p>`)
  if (f.cta) structureBlocks.push(`<div class="cta-box" style="background:#1e40af;color:#fff;padding:24px;margin:24px 0;border-radius:12px;text-align:center"><h3 style="color:#fff;margin:0 0 8px">[headline CTA]</h3><p style="margin:0 0 16px;opacity:0.9">[sottotitolo CTA]</p><a href="#" style="background:#fff;color:#1e40af;padding:10px 24px;border-radius:6px;font-weight:700;text-decoration:none">[testo bottone]</a></div>`)

  const system = `Sei un esperto copywriter, SEO specialist e GEO (Generative Engine Optimization) specialist.
Scrivi articoli di blog professionali, ottimizzati per Google e per i motori AI (ChatGPT, Perplexity, Google AI Overview).
Rispondi SEMPRE in ${langLabel}.
Rispondi SOLO con JSON valido, senza markdown o testo extra.
${businessCtx}${toneSection}`

  const userMessage = `Scrivi un articolo di blog su: "${topic}"

Keyword primaria: "${primaryKw}"
${secondaryKws.length > 0 ? `Keyword secondarie: ${secondaryKws.map(k => `"${k}"`).join(', ')}` : ''}

PARAMETRI OBBLIGATORI:
- Lunghezza esatta: ${wordCount} parole (±5%) — conta le parole nel testo visibile
- Numero di sezioni H2 principali: ${paragraphCount} (oltre a FAQ e Conclusione)
- Lingua: ${langLabel}

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
  "seo_title": "SEO title max 60 caratteri con keyword primaria",
  "seo_description": "meta description 150-160 caratteri con keyword e CTA",
  "excerpt": "riassunto 1-2 frasi max 200 caratteri",
  "categories": ["categoria pertinente"],
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "content_html": "HTML COMPLETO seguendo la struttura sopra — ${wordCount} parole"
}`

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

        // Parse final JSON
        try {
          const jsonMatch = currentJson.match(/\{[\s\S]*\}/)
          if (!jsonMatch) throw new Error('No JSON found')
          const post = JSON.parse(jsonMatch[0])
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
