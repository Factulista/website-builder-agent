import { callClaude } from './config'
// SEO_KNOWLEDGE removed — Sonnet-4.6 knows SEO best practices natively
import { buildContextPrompt, type ProjectContext } from './memory-agent'

type Page = { slug: string; name: string; html: string }

const SEO_TOOLS = [
  {
    name: 'update_seo',
    description: 'Aggiorna i meta tag SEO di una o più pagine (title, description, og:image, keywords, canonical).',
    input_schema: {
      type: 'object' as const,
      properties: {
        pages: {
          type: 'array',
          description: 'Lista di pagine con i meta tag aggiornati.',
          items: {
            type: 'object',
            properties: {
              pageSlug: { type: 'string', description: 'Slug della pagina.' },
              edits: {
                type: 'array',
                description: 'Find/replace da applicare all\'<head> della pagina.',
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
        summary: { type: 'string', description: 'Frase breve di cosa hai ottimizzato.' },
      },
      required: ['pages', 'summary'],
    },
  },
  {
    name: 'generate_sitemap',
    description: 'Genera il contenuto XML della sitemap del sito.',
    input_schema: {
      type: 'object' as const,
      properties: {
        xml: { type: 'string', description: 'Contenuto XML della sitemap.' },
        summary: { type: 'string' },
      },
      required: ['xml', 'summary'],
    },
  },
]

export async function runSeoAgent(
  messages: { role: string; content: string }[],
  pages: Page[],
  customDomain: string | null,
  apiKey: string,
  context: ProjectContext = {}
) {
  const baseUrl = customDomain ? `https://${customDomain}` : 'https://myweb.factulista.com'

  const pagesContext = pages.map(p => {
    const titleMatch = p.html.match(/<title[^>]*>(.*?)<\/title>/i)
    const descMatch = p.html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)
    return `- /${p.slug === 'home' ? '' : p.slug} ("${p.name}") | title: "${titleMatch?.[1] || 'n/a'}" | desc: "${descMatch?.[1] || 'n/a'}"`
  }).join('\n')

  const system = `Sei un esperto SEO. Ottimizzi siti web HTML per i motori di ricerca.

${buildContextPrompt(context)}

PAGINE DEL SITO:
${pagesContext}

URL BASE: ${baseUrl}

REGOLE:
- Ogni pagina deve avere: <title> unico e descrittivo (50-60 char), <meta name="description"> (150-160 char), <meta property="og:title">, <meta property="og:description">, <meta property="og:url">, <link rel="canonical">.
- Usa update_seo con find/replace sull'<head> di ogni pagina.
- Per sitemap usa generate_sitemap con XML valido che include tutte le pagine.
- NON modificare il design o il contenuto visivo, solo il <head>.`

  const res = await callClaude('seo', system, messages, SEO_TOOLS, apiKey)

  if (!res.ok) throw new Error(`Anthropic API error: ${await res.text()}`)
  const data = await res.json()
  const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
  if (!toolUse) throw new Error('No tool use in SEO response')
  return { tool: toolUse.name, input: toolUse.input, usage: data.usage }
}

export type BlogPostSeoInput = {
  id: string
  title: string
  slug: string
  excerpt: string
  seo_title: string | null
  seo_description: string | null
  tags: string[]
}

const BLOG_SEO_TOOLS = [
  {
    name: 'update_blog_posts_seo',
    description: 'Aggiorna i campi SEO (seo_title, seo_description, tags) di uno o più articoli del blog.',
    input_schema: {
      type: 'object' as const,
      properties: {
        posts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              seo_title: { type: 'string', description: '50-60 caratteri, include keyword principale' },
              seo_description: { type: 'string', description: '150-160 caratteri, persuasivo con CTA implicita' },
              tags: { type: 'array', items: { type: 'string' }, description: '3-7 tag rilevanti' },
            },
            required: ['id', 'seo_title', 'seo_description', 'tags'],
          },
        },
        summary: { type: 'string' },
      },
      required: ['posts', 'summary'],
    },
  },
]

export async function runBlogSeoAgent(
  posts: BlogPostSeoInput[],
  baseUrl: string,
  apiKey: string,
  context: ProjectContext = {}
) {
  if (posts.length === 0) return null

  const postsContext = posts.map(p =>
    `- [${p.id}] "${p.title}" (/${p.slug}) | seo_title: "${p.seo_title || 'n/a'}" | seo_desc: "${p.seo_description || 'n/a'}" | tags: [${p.tags.join(', ')}]`
  ).join('\n')

  const system = `Sei un esperto SEO. Ottimizzi i meta tag degli articoli di un blog per massimizzare il CTR e il posizionamento.

${buildContextPrompt(context)}

ARTICOLI DEL BLOG:
${postsContext}

URL BASE: ${baseUrl}

REGOLE:
- seo_title: 50-60 caratteri, include la keyword principale dell'articolo.
- seo_description: 150-160 caratteri, persuasiva, con call-to-action implicita.
- tags: 3-7 tag rilevanti, coerenti con il contenuto e il settore del sito.
- Restituisci un entry per ogni articolo nella lista.`

  const messages = [{ role: 'user', content: 'Ottimizza il SEO di tutti gli articoli del blog.' }]

  const res = await callClaude('seo', system, messages, BLOG_SEO_TOOLS, apiKey)
  if (!res.ok) throw new Error(`Blog SEO Agent error: ${await res.text()}`)
  const data = await res.json()
  const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
  if (!toolUse) throw new Error('No tool use in blog SEO response')
  return { tool: toolUse.name as string, input: toolUse.input as { posts: { id: string; seo_title: string; seo_description: string; tags: string[] }[]; summary: string }, usage: data.usage }
}
