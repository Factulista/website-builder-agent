import { fetchWithRetry } from './fetch-retry'

const IMAGES_TOOLS = [
  {
    name: 'optimize_images',
    description: 'Ottimizza il markup delle immagini in una pagina HTML: alt text, srcset, lazy loading.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pageSlug: { type: 'string' },
        edits: {
          type: 'array',
          description: 'Find/replace per aggiornare ogni immagine nel HTML.',
          items: {
            type: 'object',
            properties: {
              find: { type: 'string', description: 'Markup immagine originale da trovare.' },
              replace: { type: 'string', description: 'Markup ottimizzato con alt, loading=lazy, width, height.' },
            },
            required: ['find', 'replace'],
          },
        },
        summary: { type: 'string' },
      },
      required: ['pageSlug', 'edits', 'summary'],
    },
  },
]

export type ImagesOutput = {
  pageSlug: string
  edits: { find: string; replace: string }[]
  summary: string
}

export async function runImagesAgent(
  pageSlug: string,
  pageHtml: string,
  businessType: string,
  apiKey: string
): Promise<ImagesOutput> {
  const system = `Sei un esperto di ottimizzazione immagini web. Migliori il markup delle immagini per SEO e performance.

REGOLE:
- Ogni <img> deve avere: alt text descrittivo e contestuale, loading="lazy" (eccetto above-the-fold), width e height espliciti.
- Alt text: descrivi l'immagine in modo utile per screen reader e SEO, mai "immagine" o "foto" generici.
- Usa <picture> con srcset per immagini responsive quando appropriato.
- Non modificare src o design, solo ottimizza il markup.
- Business type: ${businessType} — usa questo contesto per alt text più specifici.`

  const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system,
      tools: IMAGES_TOOLS,
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: `Ottimizza le immagini in questa pagina (slug: ${pageSlug}):\n\n${pageHtml}` }],
    }),
  }, 'images')

  if (!res.ok) throw new Error(`Images Agent API error: ${await res.text()}`)
  const data = await res.json()
  const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
  if (!toolUse) throw new Error('No tool use in Images response')
  return toolUse.input as ImagesOutput
}
