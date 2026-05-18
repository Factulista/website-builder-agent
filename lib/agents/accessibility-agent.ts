import { fetchWithRetry } from './fetch-retry'

const ACCESSIBILITY_TOOLS = [
  {
    name: 'fix_accessibility',
    description: 'Corregge i problemi di accessibilità WCAG 2.1 AA in una pagina HTML.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pageSlug: { type: 'string' },
        issues: {
          type: 'array',
          description: 'Problemi trovati.',
          items: {
            type: 'object',
            properties: {
              rule: { type: 'string', description: 'Regola WCAG violata (es: 1.1.1, 1.4.3, 2.1.1).' },
              description: { type: 'string', description: 'Descrizione del problema.' },
              severity: { type: 'string', enum: ['critical', 'serious', 'moderate', 'minor'] },
            },
            required: ['rule', 'description', 'severity'],
          },
        },
        edits: {
          type: 'array',
          description: 'Find/replace per correggere i problemi.',
          items: {
            type: 'object',
            properties: {
              find: { type: 'string' },
              replace: { type: 'string' },
            },
            required: ['find', 'replace'],
          },
        },
        score: { type: 'string', enum: ['PASS', 'FAIL'], description: 'Esito complessivo dopo le correzioni.' },
        summary: { type: 'string' },
      },
      required: ['pageSlug', 'issues', 'edits', 'score', 'summary'],
    },
  },
]

export type AccessibilityOutput = {
  pageSlug: string
  issues: { rule: string; description: string; severity: string }[]
  edits: { find: string; replace: string }[]
  score: 'PASS' | 'FAIL'
  summary: string
}

export async function runAccessibilityAgent(
  pageSlug: string,
  pageHtml: string,
  apiKey: string
): Promise<AccessibilityOutput> {
  const system = `Sei un esperto di accessibilità web WCAG 2.1. Analizzi HTML e correggi i problemi di accessibilità.

CONTROLLA (in ordine di priorità):
1. Alt text per tutte le immagini (1.1.1)
2. Contrasto colori sufficiente 4.5:1 per testo normale, 3:1 per testo grande (1.4.3)
3. Heading hierarchy corretta: un solo H1, H2→H3→H4 in ordine (1.3.1)
4. Tutti i link hanno testo descrittivo, non "clicca qui" (2.4.4)
5. Tutti i bottoni hanno testo o aria-label (4.1.2)
6. Form labels associati agli input (1.3.1)
7. Focus visibile su elementi interattivi (2.4.7)
8. lang attribute sull'html (3.1.1)

Usa edits con find/replace per correggere ogni problema trovato. Se non ci sono problemi, ritorna edits vuoto e score PASS.`

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
      tools: ACCESSIBILITY_TOOLS,
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: `Analizza e correggi l'accessibilità di questa pagina (slug: ${pageSlug}):\n\n${pageHtml}` }],
    }),
  }, 'accessibility')

  if (!res.ok) throw new Error(`Accessibility Agent API error: ${await res.text()}`)
  const data = await res.json()
  const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
  if (!toolUse) throw new Error('No tool use in Accessibility response')
  return toolUse.input as AccessibilityOutput
}
