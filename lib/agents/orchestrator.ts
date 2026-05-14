import { runPlanner } from './planner'
import { runContentAgent } from './content-agent'
import { runDesignAgent } from './design-agent'
import { runHtmlAgentWithPlan, runHtmlAgent } from './html-agent'
import { runSeoAgent } from './seo-agent'
import { runImagesAgent } from './images-agent'
import { runAccessibilityAgent } from './accessibility-agent'

type Page = { slug: string; name: string; html: string }

type AgentType = 'pipeline' | 'html' | 'seo'

const SEO_KEYWORDS = [
  'seo', 'meta', 'title tag', 'description', 'keywords', 'sitemap',
  'robots', 'canonical', 'og:', 'open graph', 'indicizzazione', 'google',
  'posizionamento', 'rank', 'ottimizza seo', 'migliora seo',
]

const CREATE_KEYWORDS = [
  'crea', 'genera', 'costruisci', 'fai', 'nuovo sito', 'nuova homepage',
  'rifai', 'ricrea', 'da zero',
]

export function classify(userMessage: string, hasPages: boolean): AgentType {
  const lower = userMessage.toLowerCase()
  if (SEO_KEYWORDS.some(k => lower.includes(k))) return 'seo'
  if (!hasPages || CREATE_KEYWORDS.some(k => lower.includes(k))) return 'pipeline'
  return 'html'
}

export type PipelineResult = {
  tool: 'create_site'
  input: { pages: Page[]; summary: string }
  agent: 'pipeline'
  steps: string[]
  usage?: object
}

export async function runFullPipeline(
  userRequest: string,
  existingPages: Page[],
  apiKey: string
): Promise<PipelineResult> {
  const steps: string[] = []

  // Step 1: Planner
  steps.push('🗺️ Piano strutturale...')
  const plan = await runPlanner(userRequest, existingPages, apiKey)
  steps.push(`✅ Piano: ${plan.pages.map(p => p.slug).join(', ')}`)

  // Step 2: Content + Design in parallelo
  steps.push('✍️ Generazione contenuti e design in parallelo...')
  const [content, design] = await Promise.all([
    runContentAgent(userRequest, plan, apiKey),
    runDesignAgent(userRequest, plan, apiKey),
  ])
  steps.push(`✅ Contenuti pronti | ✅ Design: ${design.tokens.colors.primary}`)

  // Step 3: HTML (seriale, dipende da Content + Design)
  steps.push('🏗️ Generazione HTML...')
  const htmlOutput = await runHtmlAgentWithPlan(userRequest, plan, content, design, apiKey)
  steps.push(`✅ HTML: ${htmlOutput.pages.length} pagine generate`)

  // Step 4: Images + SEO + Accessibility in parallelo su tutte le pagine
  steps.push('🔧 Ottimizzazione immagini, SEO e accessibilità...')
  const optimizedPages = await Promise.all(
    htmlOutput.pages.map(async (page) => {
      const [imagesResult, accessibilityResult] = await Promise.all([
        runImagesAgent(page.slug, page.html, plan.businessType, apiKey).catch(() => null),
        runAccessibilityAgent(page.slug, page.html, apiKey).catch(() => null),
      ])

      let html = page.html

      // Apply images edits
      if (imagesResult?.edits) {
        for (const edit of imagesResult.edits) {
          if (html.includes(edit.find)) html = html.replace(edit.find, edit.replace)
        }
      }

      // Apply accessibility edits
      if (accessibilityResult?.edits) {
        for (const edit of accessibilityResult.edits) {
          if (html.includes(edit.find)) html = html.replace(edit.find, edit.replace)
        }
      }

      return { ...page, html }
    })
  )

  // Apply SEO across all pages
  const seoResult = await runSeoAgent(
    [{ role: 'user', content: `Ottimizza SEO per tutte le pagine del sito: ${userRequest}` }],
    optimizedPages,
    null,
    apiKey
  ).catch(() => null)

  let finalPages = optimizedPages
  if (seoResult?.tool === 'update_seo' && seoResult.input?.pages) {
    const seoPages = seoResult.input.pages as { pageSlug: string; edits: { find: string; replace: string }[] }[]
    finalPages = optimizedPages.map(page => {
      const seoPatch = seoPages.find(sp => sp.pageSlug === page.slug)
      if (!seoPatch) return page
      let html = page.html
      for (const edit of seoPatch.edits) {
        if (html.includes(edit.find)) html = html.replace(edit.find, edit.replace)
      }
      return { ...page, html }
    })
  }

  steps.push('✅ Ottimizzazione completata')

  return {
    tool: 'create_site',
    input: { pages: finalPages, summary: htmlOutput.summary },
    agent: 'pipeline',
    steps,
  }
}
