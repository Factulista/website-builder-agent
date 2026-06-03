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

export async function POST(req: NextRequest) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'API key mancante' }, { status: 500 })

  const body = await req.json()
  const { topic, keywords = [], context } = body as {
    topic: string
    keywords?: string[]
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

  const system = `Sei un esperto copywriter, SEO specialist e GEO (Generative Engine Optimization) specialist.
Scrivi articoli di blog professionali, ottimizzati per Google e per i motori AI (ChatGPT, Perplexity, Google AI Overview).
Rispondi SEMPRE in ${langLabel}.
Rispondi SOLO con JSON valido, senza markdown o testo extra.
${businessCtx}`

  const userMessage = `Scrivi un articolo di blog completo e ottimizzato su: "${topic}"

Keyword primaria: "${primaryKw}"
${secondaryKws.length > 0 ? `Keyword secondarie: ${secondaryKws.map(k => `"${k}"`).join(', ')}` : ''}

REQUISITI OBBLIGATORI:
- Lunghezza: minimo 1200 parole reali nel contenuto
- Struttura: 1 H1 (uguale al titolo), 3-4 sezioni H2, H3 per sottosezioni dove serve
- Usa almeno: 1 lista puntata/numerata + 1 tabella HTML dove appropriato
- Keyword primaria: nell'H1, nel primo paragrafo, in almeno 2 H2, nella conclusione
- Keyword secondarie: distribuite naturalmente nel testo (1-2 volte ciascuna)
- Densità keyword: 1-2% (naturale, non forzata)
- Ogni sezione H2: almeno 2-3 paragrafi

OTTIMIZZAZIONE SEO + GEO (AI Search):
- Inizia con una definizione chiara dell'argomento (favorisce Google AI Overview)
- Includi risposte dirette a domande comuni ("Cos'è X?", "Come funziona Y?")
- Usa un tono autorevole ma accessibile
- Aggiungi una sezione FAQ finale con 3-4 domande e risposte concise (ottima per GEO)
- Le risposte FAQ devono essere autonome e complete (leggibili da AI senza contesto)
- Usa <strong> per i concetti chiave
- Includi dati/statistiche specifiche dove possibile

STRUTTURA HTML richiesta:
<h1>Titolo principale con keyword primaria</h1>
<p>Paragrafo introduttivo con definizione e keyword primaria...</p>
<h2>Prima sezione</h2>
<p>...</p>
[<ul><li>...</li></ul> oppure <table>...</table> dove utile]
<h2>Seconda sezione</h2>
...
<h2>Terza sezione</h2>
...
<h2>Domande frequenti su [topic]</h2>
<h3>Domanda 1?</h3>
<p>Risposta completa...</p>
<h3>Domanda 2?</h3>
<p>Risposta completa...</p>
<h2>Conclusione</h2>
<p>...</p>

Restituisci SOLO questo JSON:
{
  "title": "titolo H1 con keyword primaria, max 70 caratteri",
  "slug": "slug-url-kebab-case-con-keyword-primaria",
  "seo_title": "titolo SEO max 60 caratteri con keyword primaria",
  "seo_description": "meta description 150-160 caratteri con keyword primaria e CTA chiara",
  "excerpt": "riassunto 1-2 frasi max 200 caratteri",
  "categories": ["categoria pertinente"],
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "content_html": "HTML COMPLETO con H1+H2+H3+p+ul/ol+table+strong — MINIMO 1200 parole — includi FAQ finale"
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
