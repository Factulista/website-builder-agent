import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

type ImageMeta = {
  alt: string
  title: string
  description: string
  suggestedFilename: string
}

export async function POST(req: NextRequest) {
  try {
    const { imageUrl, context } = await req.json() as {
      imageUrl: string
      context?: {
        businessName?: string
        businessType?: string
        services?: string[]
        language?: string
        targetAudience?: string
      }
    }

    if (!imageUrl) {
      return NextResponse.json({ error: 'imageUrl richiesto' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'API key mancante' }, { status: 500 })
    }

    const lang = context?.language ?? 'it'
    const langLabel = lang === 'es' ? 'spagnolo' : lang === 'en' ? 'inglese' : 'italiano'

    const contextBlock = context ? `
Contesto del sito:
- Business: ${context.businessName ?? '—'}
- Settore: ${context.businessType ?? '—'}
- Servizi: ${context.services?.join(', ') ?? '—'}
- Target: ${context.targetAudience ?? '—'}
` : ''

    const system = `Sei un esperto SEO e accessibilità web. Analizzi immagini e generi metadati ottimizzati.
Rispondi SEMPRE in ${langLabel}.
Rispondi SOLO con JSON valido, senza markdown o testo extra.`

    const userMessage = `Analizza questa immagine e genera i metadati SEO ottimizzati.
${contextBlock}
Restituisci un JSON con questi campi:
{
  "alt": "testo alternativo descrittivo per accessibilità, max 125 caratteri, include keyword rilevanti per il settore",
  "title": "titolo breve dell'immagine, max 60 caratteri",
  "description": "descrizione estesa per il campo description, max 200 caratteri",
  "suggestedFilename": "nome-file-seo-friendly senza estensione, lowercase con trattini, include keyword del settore, max 50 caratteri"
}`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'url', url: imageUrl },
              },
              {
                type: 'text',
                text: userMessage,
              },
            ],
          },
        ],
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('generate-image-meta: Claude error', res.status, err)
      return NextResponse.json({ error: 'Errore AI' }, { status: 500 })
    }

    const data = await res.json()
    const text = data.content?.[0]?.text ?? ''

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Risposta AI non valida' }, { status: 500 })
    }

    const meta: ImageMeta = JSON.parse(jsonMatch[0])

    return NextResponse.json(meta)
  } catch (error) {
    console.error('generate-image-meta error:', error)
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 })
  }
}
