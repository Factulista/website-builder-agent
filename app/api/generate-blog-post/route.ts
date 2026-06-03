import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const maxDuration = 60

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

/** Strip HTML tags and collapse whitespace */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Fetch existing blog posts to extract tone of voice */
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
      // Take first ~300 words per article
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
    projectId,
    context,
  } = body as {
    topic: string
    keywords?: string[]
    wordCount?: number
    paragraphCount?: number
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

  // Load tone of voice from existing posts
  const toneOfVoice = projectId ? await getToneOfVoiceSample(projectId) : ''
  const toneSection = toneOfVoice
    ? `\n\nTONO DI VOCE — prendi spunto da questi articoli già pubblicati per replicare lo stesso stile, registro e lunghezza delle frasi:\n${toneOfVoice}`
    : ''

  // Build H2 sections instruction
  const h2Sections = Array.from({ length: paragraphCount }, (_, i) =>
    `<h2>Sezione ${i + 1}: [titolo con keyword]</h2>\n<p>[contenuto...]</p>`
  ).join('\n')

  const system = `Sei un esperto copywriter, SEO specialist e GEO (Generative Engine Optimization) specialist.
Scrivi articoli di blog professionali, ottimizzati per Google e per i motori AI (ChatGPT, Perplexity, Google AI Overview).
Rispondi SEMPRE in ${langLabel}.
Rispondi SOLO con JSON valido, senza markdown o testo extra.
${businessCtx}${toneSection}`

  const userMessage = `Scrivi un articolo di blog su: "${topic}"

Keyword primaria: "${primaryKw}"
${secondaryKws.length > 0 ? `Keyword secondarie: ${secondaryKws.map(k => `"${k}"`).join(', ')}` : ''}

PARAMETRI OBBLIGATORI:
- Lunghezza esatta: ${wordCount} parole (±5%)
- Numero di sezioni H2 principali: ${paragraphCount} (esclusi intro, FAQ e conclusione)
- Lingua: ${langLabel}

STRUTTURA HTML obbligatoria:
<h1>[keyword primaria nel titolo]</h1>
<p>[intro: definizione chiara dell'argomento + keyword primaria nel primo paragrafo]</p>

[${paragraphCount} sezioni H2, ognuna con 2-3 paragrafi <p> e dove pertinente <ul>/<ol>/<table>]

<h2>Domande frequenti su [topic]</h2>
[3 domande come <h3> con risposta in <p> — risposte autonome e complete, ottimali per AI Overview]

<h2>Conclusione</h2>
<p>[sintesi con keyword primaria + CTA]</p>

REGOLE SEO:
- Keyword primaria: in H1, primo paragrafo, almeno 2 H2, conclusione
- Keyword secondarie: distribuite (1-2 volte ciascuna, mai forzate)
- Densità keyword primaria: 1-2%
- Usa <strong> per concetti chiave (2-3 per sezione max)
- Includi almeno 1 lista (<ul> o <ol>) e 1 tabella (<table>) nel corpo

REGOLE GEO (AI Search Optimization):
- Primo paragrafo: definizione diretta e concisa (Google AI Overview la preleva)
- FAQ: risposte complete e autonome, leggibili senza contesto da parte di AI
- Usa frasi dirette ("X è...", "Per fare Y bisogna...", "Il vantaggio principale è...")
- Includi almeno 1 dato/statistica concreta se disponibile

Restituisci SOLO questo JSON (nessun testo fuori):
{
  "title": "H1 con keyword primaria, max 70 caratteri",
  "slug": "slug-kebab-case-con-keyword",
  "seo_title": "SEO title max 60 caratteri con keyword primaria",
  "seo_description": "meta description 150-160 caratteri con keyword e CTA",
  "excerpt": "riassunto 1-2 frasi max 200 caratteri",
  "categories": ["categoria pertinente"],
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "content_html": "HTML COMPLETO — H1+${paragraphCount}×H2+FAQ H2+Conclusione H2 — ${wordCount} parole — include <ul>/<ol> e <table>"
}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content: userMessage }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[generate-blog-post] Claude error', res.status, err)
    return NextResponse.json({ error: 'Errore AI', detail: err }, { status: 500 })
  }

  const data = await res.json()
  const text = data.content?.[0]?.text ?? ''

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    console.error('[generate-blog-post] No JSON in response:', text.slice(0, 200))
    return NextResponse.json({ error: 'Risposta AI non valida' }, { status: 500 })
  }

  try {
    const post = JSON.parse(jsonMatch[0])
    return NextResponse.json({ post })
  } catch (e) {
    console.error('[generate-blog-post] JSON parse error:', e)
    return NextResponse.json({ error: 'JSON non valido' }, { status: 500 })
  }
}
