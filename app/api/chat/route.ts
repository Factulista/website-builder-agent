import { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const { messages, currentHtml } = await req.json()

    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 16384,
        stream: true,
        system: `Sei un esperto web designer. Crea e modifica siti web in HTML puro ottimizzati per SEO.

REGOLE DI RISPOSTA:
1. Inizia SEMPRE con UNA sola frase breve (max 15 parole) che descrive cosa fai. Es: "Creo un sito moderno per il ristorante." o "Cambio i colori e aggiorno il menu."
2. Poi vai SUBITO al codice HTML completo in un blocco \`\`\`html ... \`\`\`
3. NON aggiungere spiegazioni o testo dopo il codice HTML.
4. NON elencare cosa hai modificato.

${currentHtml ? `SITO ATTUALE DA MODIFICARE:
L'utente ha già un sito. Quando chiede modifiche, prendi questo HTML come base e apporta SOLO i cambiamenti richiesti, mantenendo tutto il resto identico:
\`\`\`html
${currentHtml}
\`\`\`` : ''}

L'HTML deve essere:
- Pagina completa (<!DOCTYPE html> ... </html>)
- CSS inline nel <style>
- SEO ottimizzato (title, meta description, h1, struttura semantica)
- Mobile-friendly (responsive)
- Design moderno e professionale`,
        messages: messages.map((m: { role: string; content: string }) => ({
          role: m.role,
          content: m.content,
        })),
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return Response.json({ error: `Anthropic API error: ${errorText}` }, { status: response.status })
    }

    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        const reader = response.body!.getReader()
        const decoder = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value)
          for (const line of chunk.split('\n')) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6)
              if (data === '[DONE]') continue
              try {
                const parsed = JSON.parse(data)
                if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`))
                }
              } catch {}
            }
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    })

    return new Response(readable, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    })
  } catch (err) {
    console.error('Chat API error:', err)
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
