import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

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
  const { topic, context } = body as {
    topic: string
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
  const langLabel = lang === 'es' ? 'spagnolo' : lang === 'en' ? 'inglese' : 'italiano'
  const businessContext = context ? `
Contesto del sito:
- Business: ${context.businessName ?? '—'}
- Settore: ${context.businessType ?? '—'}
- Servizi: ${context.services?.join(', ') ?? '—'}
- Target: ${context.targetAudience ?? '—'}` : ''

  const system = `Sei un esperto copywriter e SEO specialist. Scrivi articoli di blog professionali e ottimizzati per i motori di ricerca.
Rispondi SEMPRE in ${langLabel}.
Rispondi SOLO con JSON valido, senza markdown o testo extra.
${businessContext}`

  const userMessage = `Scrivi un articolo di blog completo su questo argomento: "${topic}"

Restituisci un JSON con questi campi:
{
  "title": "titolo SEO-friendly, max 70 caratteri",
  "slug": "slug-url-friendly-senza-accenti-e-spazi",
  "seo_title": "titolo SEO ottimizzato, max 60 caratteri, con keyword primaria",
  "seo_description": "meta description, max 160 caratteri, con keyword e CTA",
  "excerpt": "riassunto di 1-2 frasi, max 200 caratteri",
  "categories": ["categoria1", "categoria2"],
  "tags": ["tag1", "tag2", "tag3"],
  "content_html": "HTML completo dell'articolo con heading H2/H3, paragrafi, liste. SOLO il body content, senza html/head/body tags. Usa tag semantici: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <blockquote>. Minimo 500 parole."
}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20251001',
      max_tokens: 8192,
      system,
      messages: [{ role: 'user', content: userMessage }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('generate-blog-post: Claude error', res.status, err)
    return NextResponse.json({ error: 'Errore AI' }, { status: 500 })
  }

  const data = await res.json()
  const text = data.content?.[0]?.text ?? ''

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return NextResponse.json({ error: 'Risposta AI non valida' }, { status: 500 })
  }

  try {
    const post = JSON.parse(jsonMatch[0])
    return NextResponse.json({ post })
  } catch {
    return NextResponse.json({ error: 'JSON non valido' }, { status: 500 })
  }
}
