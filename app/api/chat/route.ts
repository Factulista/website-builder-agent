import { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const TOOLS = [
  {
    name: 'create_site',
    description: 'Crea un sito web da zero. Usalo SOLO per il primo sito o quando l\'utente chiede una riscrittura completa (es: "rifai tutto", "cambia tipo di sito").',
    input_schema: {
      type: 'object' as const,
      properties: {
        html: { type: 'string', description: 'HTML completo del sito (<!DOCTYPE html> ... </html>), con CSS inline e responsive.' },
        summary: { type: 'string', description: 'Una breve frase (max 12 parole) che descrive cosa hai creato.' },
      },
      required: ['html', 'summary'],
    },
  },
  {
    name: 'edit_site',
    description: 'Modifica un sito esistente facendo SOSTITUZIONI mirate. USA QUESTO TOOL per OGNI modifica al sito esistente (cambio colori, testo, layout, aggiungi sezioni). Molto più efficiente di rigenerare tutto.',
    input_schema: {
      type: 'object' as const,
      properties: {
        edits: {
          type: 'array',
          description: 'Lista di sostituzioni find/replace da applicare in ordine.',
          items: {
            type: 'object',
            properties: {
              find: { type: 'string', description: 'Testo ESATTO da trovare nell\'HTML attuale (deve essere unico nel documento). Includi abbastanza contesto per renderlo univoco.' },
              replace: { type: 'string', description: 'Testo con cui sostituirlo.' },
            },
            required: ['find', 'replace'],
          },
        },
        summary: { type: 'string', description: 'Una breve frase (max 12 parole) che descrive cosa hai modificato.' },
      },
      required: ['edits', 'summary'],
    },
  },
]

export async function POST(req: NextRequest) {
  try {
    const { messages, currentHtml } = await req.json()

    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
    }

    const systemPrompt = `Sei un esperto web designer. Crei e modifichi siti web in HTML puro ottimizzati per SEO.

REGOLE:
- Se NON c'è un sito esistente, usa il tool \`create_site\` per crearlo da zero.
- Se c'è già un sito, usa SEMPRE \`edit_site\` per modifiche (cambio colori, testo, sezioni). NON ricreare l'intero sito.
- Usa \`create_site\` su sito esistente SOLO se l'utente chiede esplicitamente di rifare tutto.

L'HTML deve essere: pagina completa, CSS inline nel <style>, SEO ottimizzato (title, meta description, h1, semantica), responsive mobile, design moderno e professionale.

IMMAGINI:
- Includi SEMPRE immagini di alta qualità nei siti che crei (hero image, immagini di sezione, ecc).
- Usa questi servizi gratuiti per immagini realistiche (no API key richiesta):
  * Hero/sfondi: \`https://images.unsplash.com/photo-{id}?w=1600&q=80\` — quando hai dubbi, usa: \`https://picsum.photos/seed/{parolachiave}/1600/900\`
  * Foto generiche per categoria: \`https://picsum.photos/seed/{slug-univoco}/800/600\` (cambia lo "seed" per ogni immagine per averne di diverse)
  * Avatar/people: \`https://i.pravatar.cc/300?u={username}\` (per testimonianze, team)
- IMPORTANTE: usa sempre \`object-fit: cover\` nei CSS delle immagini e attributi \`alt\` descrittivi per SEO.
- Per immagini Unsplash usa URL di foto che esistono. Se incerto, usa picsum.photos con un seed univoco.

${currentHtml ? `SITO ATTUALE:
\`\`\`html
${currentHtml}
\`\`\`

Per modifiche piccole, identifica il testo ESATTO da cambiare nell'HTML sopra e usa edit_site con find/replace mirati.` : 'Nessun sito ancora generato.'}`

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
        system: systemPrompt,
        tools: TOOLS,
        tool_choice: { type: 'any' },
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

    const data = await response.json()

    const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
    if (!toolUse) {
      return Response.json({ error: 'No tool use in response', raw: data }, { status: 500 })
    }

    return Response.json({
      tool: toolUse.name,
      input: toolUse.input,
      usage: data.usage,
    })
  } catch (err) {
    console.error('Chat API error:', err)
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
