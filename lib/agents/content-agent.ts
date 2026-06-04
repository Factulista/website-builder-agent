import { callClaude } from './config'
// CONTENT_KNOWLEDGE removed — Sonnet-4.6 knows copywriting natively
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

const LANGUAGE_NAMES: Record<string, string> = {
  it: 'italiano',
  es: 'spagnolo',
  en: 'inglese',
  de: 'tedesco',
  fr: 'francese',
  pt: 'portoghese',
}

export async function runContentAgent(
  userRequest: string,
  plan: SitePlan,
  apiKey: string,
  context: ProjectContext = {}
): Promise<ContentOutput> {
  const language = (context.language as string) || 'it'
  const langName = LANGUAGE_NAMES[language] || 'italiano'

  const system = `Sei un copywriter esperto in ${langName}. Scrivi testi persuasivi, chiari e ottimizzati SEO per siti web.



${buildContextPrompt(context)}

PIANO DEL SITO:
Business: ${plan.businessType}
${plan.targetAudience ? `Target: ${plan.targetAudience}` : ''}
Pagine:
${plan.pages.map(p => `- ${p.slug} ("${p.name}"): ${p.sections.join(', ')} — ${p.purpose}`).join('\n')}

REGOLE:
- Scrivi in ${langName}, tono professionale ma accessibile.
- H1 chiaro e descrittivo (include keyword principale).
- Meta description max 160 caratteri, include call to action.
- Ogni sezione deve avere testi coerenti tra loro.
- CTA specifici e persuasivi (non "Clicca qui", "Haz clic aquí", etc).
- Per Schema.org: usa il tipo più specifico disponibile (Restaurant, LegalService, MedicalBusiness, ecc.).`

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await callClaude('content', system, [{ role: 'user', content: userRequest }], CONTENT_TOOLS, apiKey)

    if (!res.ok) throw new Error(`Content Agent API error: ${await res.text()}`)
    const data = await res.json()

    if (data.stop_reason === 'max_tokens') {
      if (attempt < 2) { await new Promise(r => setTimeout(r, 1500)); continue }
      throw new Error('Content agent: risposta troncata dopo max_tokens')
    }

    const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
    if (!toolUse || !toolUse.input?.pages?.length) {
      if (attempt < 2) { await new Promise(r => setTimeout(r, 1500)); continue }
      throw new Error('Content agent: nessun contenuto valido generato')
    }

    return toolUse.input as ContentOutput
  }

  throw new Error('Content agent: troppi tentativi falliti')
}

type Page = { slug: string; name: string; html: string }

const CONTENT_UPDATE_TOOLS = [
  {
    name: 'update_content',
    description: 'Aggiorna i testi di tutte le pagine del sito con find/replace mirati.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              pageSlug: { type: 'string' },
              edits: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    find: { type: 'string' },
                    replace: { type: 'string' },
                  },
                  required: ['find', 'replace'],
                },
              },
            },
            required: ['pageSlug', 'edits'],
          },
        },
        summary: { type: 'string' },
      },
      required: ['pages', 'summary'],
    },
  },
]

export async function runContentAgentUpdate(
  userRequest: string,
  pages: Page[],
  apiKey: string,
  context: ProjectContext = {}
): Promise<{ pages: Page[]; summary: string }> {
  const pagesContext = pages.map(p => `=== ${p.slug} ===\n${p.html.slice(0, 4000)}`).join('\n\n')

  const system = `Sei un copywriter esperto in italiano. Aggiorni i testi di siti web esistenti tramite find/replace mirati.



${buildContextPrompt(context)}

REGOLE:
- Usa update_content con find/replace precisi sui testi esistenti.
- Applica le modifiche a TUTTE le pagine in modo coerente (stesso tono, stesso stile).
- Modifica solo testo — non CSS, classi HTML o attributi.
- I find devono essere stringhe ESATTE presenti nell'HTML.
- Mantieni la struttura HTML invariata.`

  const res = await callClaude(
    'content',
    system,
    [{ role: 'user', content: `Richiesta: ${userRequest}\n\nPAGINE ATTUALI:\n${pagesContext}` }],
    CONTENT_UPDATE_TOOLS,
    apiKey
  )

  if (!res.ok) throw new Error(`Content Update error: ${await res.text()}`)
  const data = await res.json()
  const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
  if (!toolUse) throw new Error('No tool use in Content Update response')

  const result = toolUse.input as { pages: { pageSlug: string; edits: { find: string; replace: string }[] }[]; summary: string }

  const updatedPages = pages.map(page => {
    const patch = result.pages?.find(p => p.pageSlug === page.slug)
    if (!patch) return page
    let html = page.html
    for (const edit of patch.edits) {
      if (html.includes(edit.find)) html = html.replace(edit.find, edit.replace)
    }
    return { ...page, html }
  })

  return { pages: updatedPages, summary: result.summary }
}
