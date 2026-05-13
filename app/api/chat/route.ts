import Anthropic from '@anthropic-ai/sdk'
import { NextRequest } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const { messages, projectId } = await req.json()

  const stream = await anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 8096,
    system: `Sei un esperto web designer e sviluppatore. Il tuo compito è creare siti web in HTML puro, ottimizzati per SEO.
Quando l'utente descrive il sito che vuole, rispondi con:
1. Un breve piano di cosa creerai
2. Il codice HTML completo in un blocco \`\`\`html ... \`\`\`

Il codice HTML deve:
- Essere una pagina completa (<!DOCTYPE html> fino a </html>)
- Includere CSS inline nel <style>
- Essere ottimizzato SEO (title, meta description, h1, struttura semantica)
- Essere mobile-friendly (responsive)
- Usare un design moderno e professionale`,
    messages: messages.map((m: { role: string; content: string }) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  })

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`))
        }
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })

  return new Response(readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  })
}
