import { fetchWithRetry } from './fetch-retry'

type Page = { slug: string; name: string; html: string }

const PLANNER_TOOLS = [
  {
    name: 'plan_site',
    description: 'Crea un piano strutturale per il sito: pagine necessarie e struttura di ogni pagina.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pages: {
          type: 'array',
          description: 'Pagine da creare o modificare.',
          items: {
            type: 'object',
            properties: {
              slug: { type: 'string', description: 'Slug URL (es: home, chi-siamo, contatti).' },
              name: { type: 'string', description: 'Nome leggibile (es: Home, Chi Siamo).' },
              sections: {
                type: 'array',
                description: 'Sezioni della pagina in ordine (es: hero, features, testimonials, cta, footer).',
                items: { type: 'string' },
              },
              purpose: { type: 'string', description: 'Scopo della pagina in una frase.' },
            },
            required: ['slug', 'name', 'sections', 'purpose'],
          },
        },
        businessType: { type: 'string', description: 'Tipo di business (es: ristorante, e-commerce, studio legale).' },
        targetAudience: { type: 'string', description: 'Target di riferimento.' },
        summary: { type: 'string', description: 'Frase breve del piano.' },
      },
      required: ['pages', 'businessType', 'summary'],
    },
  },
]

export type SitePlan = {
  pages: { slug: string; name: string; sections: string[]; purpose: string }[]
  businessType: string
  targetAudience?: string
  summary: string
}

export async function runPlanner(
  userRequest: string,
  existingPages: Page[],
  apiKey: string
): Promise<SitePlan> {
  const hasPages = existingPages.length > 0
  const isFirstRun = !hasPages

  const system = `Sei un information architect. Pianifichi la struttura di siti web prima che vengano creati.

Il tuo output è un piano strutturale: quali pagine servono e quali sezioni deve avere ognuna.

SEZIONI DISPONIBILI: hero, navbar, features, benefits, testimonials, pricing, faq, cta, gallery, team, contact-form, map, footer, blog-list, blog-post, about, stats, clients, portfolio

REGOLE:
${isFirstRun
  ? `- PRIMA RUN: genera SOLO la pagina "home". L'utente aggiungerà altre pagine via chat successivamente.
- Home deve avere sezioni essenziali: navbar, hero, features/benefits, cta, footer.`
  : `- AGGIUNGI PAGINE: il sito esiste già. Pianifica SOLO le nuove pagine richieste dall'utente.
- NON includere "home" né le pagine esistenti nel piano — esistono già e non vanno toccate.
- Scegli le sezioni più appropriate per ogni nuova pagina, in ordine logico dall'alto al basso.
- Includi sempre navbar e footer nelle nuove pagine per coerenza.
- PAGINE GIÀ ESISTENTI (non ri-pianificare): ${existingPages.map(p => `${p.slug} (${p.name})`).join(', ')}`}
`

  const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system,
      tools: PLANNER_TOOLS,
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: userRequest }],
    }),
  }, 'planner')

  if (!res.ok) throw new Error(`Planner API error: ${await res.text()}`)
  const data = await res.json()
  const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
  if (!toolUse) throw new Error('No tool use in Planner response')
  const plan = toolUse.input as SitePlan
  // Normalize slugs: model sometimes uses './' or '/' for home
  if (plan.pages) {
    plan.pages = plan.pages.map(p => ({
      ...p,
      slug: p.slug === './' || p.slug === '/' || p.slug === '' ? 'home' : p.slug.replace(/^\/|\/$/g, ''),
    }))
  }
  return plan
}
