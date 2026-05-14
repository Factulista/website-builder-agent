import { callClaude } from './config'
import { CONTENT_KNOWLEDGE } from './knowledge/content'
import { buildContextPrompt, type ProjectContext } from './memory-agent'
import type { SitePlan } from './planner'

const CONTENT_TOOLS = [
  {
    name: 'generate_content',
    description: 'Genera tutti i testi e i contenuti per le pagine del sito.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              slug: { type: 'string' },
              title: { type: 'string', description: 'Tag <title> SEO della pagina.' },
              metaDescription: { type: 'string', description: 'Meta description (max 160 char).' },
              h1: { type: 'string', description: 'Headline principale della pagina.' },
              sections: {
                type: 'array',
                description: 'Contenuto testuale di ogni sezione.',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string', description: 'Tipo sezione (es: hero, features, cta).' },
                    headline: { type: 'string' },
                    subheadline: { type: 'string' },
                    body: { type: 'string' },
                    cta: { type: 'string', description: 'Testo del bottone CTA se presente.' },
                    items: {
                      type: 'array',
                      description: 'Lista di punti, features, testimonials ecc.',
                      items: {
                        type: 'object',
                        properties: {
                          title: { type: 'string' },
                          description: { type: 'string' },
                        },
                      },
                    },
                  },
                  required: ['type'],
                },
              },
              schemaOrg: { type: 'string', description: 'JSON-LD Schema.org appropriato per il business (es: LocalBusiness, Restaurant, LegalService).' },
            },
            required: ['slug', 'title', 'metaDescription', 'h1', 'sections'],
          },
        },
        summary: { type: 'string' },
      },
      required: ['pages', 'summary'],
    },
  },
]

export type PageContent = {
  slug: string
  title: string
  metaDescription: string
  h1: string
  sections: {
    type: string
    headline?: string
    subheadline?: string
    body?: string
    cta?: string
    items?: { title: string; description: string }[]
  }[]
  schemaOrg?: string
}

export type ContentOutput = {
  pages: PageContent[]
  summary: string
}

export async function runContentAgent(
  userRequest: string,
  plan: SitePlan,
  apiKey: string,
  context: ProjectContext = {}
): Promise<ContentOutput> {
  const system = `Sei un copywriter esperto in italiano. Scrivi testi persuasivi, chiari e ottimizzati SEO per siti web.

${CONTENT_KNOWLEDGE}

${buildContextPrompt(context)}

PIANO DEL SITO:
Business: ${plan.businessType}
${plan.targetAudience ? `Target: ${plan.targetAudience}` : ''}
Pagine:
${plan.pages.map(p => `- ${p.slug} ("${p.name}"): ${p.sections.join(', ')} — ${p.purpose}`).join('\n')}

REGOLE:
- Scrivi in italiano, tono professionale ma accessibile.
- H1 chiaro e descrittivo (include keyword principale).
- Meta description max 160 caratteri, include call to action.
- Ogni sezione deve avere testi coerenti tra loro.
- CTA specifici e persuasivi (non "Clicca qui").
- Per Schema.org: usa il tipo più specifico disponibile (Restaurant, LegalService, MedicalBusiness, ecc.).`

  const res = await callClaude('content', system, [{ role: 'user', content: userRequest }], CONTENT_TOOLS, apiKey)

  if (!res.ok) throw new Error(`Content Agent API error: ${await res.text()}`)
  const data = await res.json()
  const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
  if (!toolUse) throw new Error('No tool use in Content response')
  return toolUse.input as ContentOutput
}
