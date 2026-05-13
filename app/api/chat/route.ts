import { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

type Page = { slug: string; name: string; html: string }

const TOOLS = [
  {
    name: 'create_site',
    description: 'Crea un sito multi-pagina da zero. Usalo SOLO per il primo sito o quando l\'utente chiede di rifare tutto.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pages: {
          type: 'array',
          description: 'Pagine del sito. Devi includere almeno una pagina con slug "home". Slug aggiuntivi consigliati: "chi-siamo", "contatti", ecc.',
          items: {
            type: 'object',
            properties: {
              slug: { type: 'string', description: 'Slug URL della pagina (es: home, chi-siamo, contatti). Solo minuscole, numeri, trattini.' },
              name: { type: 'string', description: 'Nome leggibile della pagina (es: Home, Chi Siamo, Contatti).' },
              html: { type: 'string', description: 'HTML completo della pagina (<!DOCTYPE html> ... </html>).' },
            },
            required: ['slug', 'name', 'html'],
          },
        },
        summary: { type: 'string', description: 'Frase breve (max 12 parole) di cosa hai creato.' },
      },
      required: ['pages', 'summary'],
    },
  },
  {
    name: 'edit_page',
    description: 'Modifica UNA pagina specifica del sito con find/replace mirati. USA QUESTO per ogni modifica a una pagina esistente.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pageSlug: { type: 'string', description: 'Slug della pagina da modificare (es: "home", "chi-siamo").' },
        edits: {
          type: 'array',
          description: 'Sostituzioni find/replace da applicare.',
          items: {
            type: 'object',
            properties: {
              find: { type: 'string', description: 'Testo ESATTO da trovare (deve essere unico nella pagina).' },
              replace: { type: 'string', description: 'Testo con cui sostituirlo.' },
            },
            required: ['find', 'replace'],
          },
        },
        summary: { type: 'string', description: 'Frase breve di cosa hai modificato.' },
      },
      required: ['pageSlug', 'edits', 'summary'],
    },
  },
  {
    name: 'add_page',
    description: 'Aggiunge una NUOVA pagina al sito esistente (es: blog, prodotti, FAQ).',
    input_schema: {
      type: 'object' as const,
      properties: {
        slug: { type: 'string', description: 'Slug URL (minuscole, trattini).' },
        name: { type: 'string', description: 'Nome leggibile della pagina.' },
        html: { type: 'string', description: 'HTML completo della nuova pagina.' },
        summary: { type: 'string', description: 'Frase breve.' },
      },
      required: ['slug', 'name', 'html', 'summary'],
    },
  },
  {
    name: 'delete_page',
    description: 'Elimina una pagina dal sito. Non può eliminare la pagina "home".',
    input_schema: {
      type: 'object' as const,
      properties: {
        pageSlug: { type: 'string', description: 'Slug della pagina da eliminare.' },
        summary: { type: 'string', description: 'Frase breve.' },
      },
      required: ['pageSlug', 'summary'],
    },
  },
]

export async function POST(req: NextRequest) {
  try {
    const { messages, pages, activePageSlug } = await req.json() as {
      messages: { role: string; content: string }[]
      pages: Page[]
      activePageSlug: string | null
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
    }

    const hasPages = pages && pages.length > 0
    const activePage = hasPages ? (pages.find(p => p.slug === activePageSlug) || pages[0]) : null

    const pagesOverview = hasPages
      ? pages.map(p => `- /${p.slug === 'home' ? '' : p.slug} ("${p.name}")`).join('\n')
      : 'Nessuna pagina ancora.'

    const systemPrompt = `Sei un esperto web designer. Crei e modifichi siti web MULTI-PAGINA in HTML puro ottimizzati per SEO.

REGOLE:
- Se NON c'è un sito esistente, usa \`create_site\` (crea almeno la pagina "home"; aggiungi altre pagine come "chi-siamo", "contatti" se ha senso per il sito richiesto).
- Per modifiche a una pagina esistente, usa SEMPRE \`edit_page\` con find/replace mirati. NON ricreare l'intera pagina.
- Per aggiungere una nuova pagina, usa \`add_page\`.
- Per eliminare una pagina, usa \`delete_page\` (non puoi eliminare "home").

LINK TRA PAGINE:
- Nei menu di navigazione usa link RELATIVI: \`<a href="./">Home</a>\`, \`<a href="./chi-siamo">Chi Siamo</a>\`, \`<a href="./contatti">Contatti</a>\`.
- NON usare \`.html\` nei link. Solo lo slug.

OGNI PAGINA deve essere: HTML completo (<!DOCTYPE html> ... </html>), CSS inline, SEO ottimizzato, mobile-friendly, design moderno e coerente tra pagine (stessi colori, stesso menu navigazione).

IMMAGINI: usa \`https://picsum.photos/seed/{keyword-univoca}/{w}/{h}\` per foto generiche (cambia il seed per ogni immagine) o \`https://i.pravatar.cc/300?u={username}\` per persone.

PAGINE ATTUALI DEL SITO:
${pagesOverview}

${activePage ? `PAGINA ATTIVA (su cui l'utente sta lavorando): "${activePage.name}" (slug: "${activePage.slug}")

HTML ATTUALE DI QUESTA PAGINA:
\`\`\`html
${activePage.html}
\`\`\`

Quando l'utente chiede modifiche generiche (senza specificare la pagina), modifica questa pagina attiva.` : ''}`

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
        messages: messages.map(m => ({ role: m.role, content: m.content })),
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
