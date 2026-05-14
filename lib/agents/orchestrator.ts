import { runPlanner } from './planner'
import { runContentAgent } from './content-agent'
import { runDesignAgent } from './design-agent'
import { runHtmlAgentWithPlan, runHtmlAgent } from './html-agent'
import { runSeoAgent } from './seo-agent'
import { runImagesAgent } from './images-agent'
import { runAccessibilityAgent } from './accessibility-agent'
import { runMemoryAgent, type ProjectContext } from './memory-agent'
import { analyzeSite, extractUrls, type DesignBrief } from './site-analyzer'

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
  updatedContext?: ProjectContext
  usage?: object
}

export async function runFullPipeline(
  userRequest: string,
  existingPages: Page[],
  apiKey: string,
  context: ProjectContext = {}
): Promise<PipelineResult> {
  const steps: string[] = []

  // Step 0: Memory — aggiorna contesto dal messaggio utente
  const updatedContext = await runMemoryAgent(
    [{ role: 'user', content: userRequest }],
    context,
    apiKey
  ).catch(() => null)
  const activeContext = updatedContext ?? context

  // Step 1: Planner
  steps.push('🗺️ Piano strutturale...')
  const plan = await runPlanner(userRequest, existingPages, apiKey)
  if (!plan?.pages?.length) throw new Error('Planner non ha prodotto un piano valido')
  steps.push(`✅ Piano: ${plan.pages.map(p => p.slug).join(', ')}`)

  // Step 2a: Site Analyzer — analizza URL di ispirazione se presenti
  const urls = extractUrls(userRequest)
  let inspirationBriefs: DesignBrief[] = []
  if (urls.length > 0) {
    steps.push(`🔍 Analisi ${urls.length} sito/i di ispirazione...`)
    inspirationBriefs = (await Promise.all(urls.map(url => analyzeSite(url, apiKey)))).filter(Boolean) as DesignBrief[]
    if (inspirationBriefs.length > 0) {
      steps.push(`✅ Design brief estratti da: ${inspirationBriefs.map(b => b.sourceUrl).join(', ')}`)
    }
  }

  // Step 2b: Content + Design in parallelo (con contesto + ispirazione)
  steps.push('✍️ Generazione contenuti e design in parallelo...')
  const [content, design] = await Promise.all([
    runContentAgent(userRequest, plan, apiKey, activeContext),
    runDesignAgent(userRequest, plan, apiKey, activeContext, inspirationBriefs),
  ])
  if (!content?.pages) throw new Error('Content agent non ha prodotto contenuti validi')
  if (!design?.tokens) throw new Error('Design agent non ha prodotto un design valido')
  steps.push(`✅ Contenuti pronti | ✅ Design: ${design.tokens.colors?.primary ?? 'ok'}`)

  // Step 3: HTML (seriale, dipende da Content + Design)
  steps.push('🏗️ Generazione HTML...')
  const htmlOutput = await runHtmlAgentWithPlan(userRequest, plan, content, design, apiKey)
  if (!htmlOutput?.pages?.length) throw new Error('HTML agent non ha generato pagine valide')
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
    updatedContext: updatedContext ?? undefined,
  }
}
