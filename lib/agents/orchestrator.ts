import { runPlanner } from './planner'
import { runContentAgent, runContentAgentUpdate } from './content-agent'
import { runDesignAgent, runDesignAgentUpdate } from './design-agent'
import { runHtmlAgentWithPlan, runHtmlAgent, runHtmlAgentFromTemplate } from './html-agent'
import { runSeoAgent } from './seo-agent'
import { runImagesAgent } from './images-agent'
import { runAccessibilityAgent } from './accessibility-agent'
import { runMemoryAgent, type ProjectContext } from './memory-agent'
import { analyzeSite, extractUrls, type DesignBrief } from './site-analyzer'
import { detectTemplate, loadTemplate } from '../templates/index'

type Page = { slug: string; name: string; html: string }

type AgentType = 'pipeline' | 'html' | 'design-update' | 'content-update' | 'seo' | 'images'

const LANGUAGE_PATTERNS: Record<string, string[]> = {
  it: ['italia', 'italiano', 'italiani', 'per l\'italia'],
  es: ['spagna', 'spagnolo', 'spagnoli', 'españa', 'autonomos', 'pyme', 'for spain', 'spanish'],
  en: ['england', 'english', 'uk', 'usa', 'united states', 'american', 'per gli inglesi'],
  de: ['germany', 'german', 'deutschland', 'tedesco', 'tedeschi'],
  fr: ['france', 'french', 'français', 'francese', 'francesi'],
  pt: ['portugal', 'portuguese', 'portuguese', 'portoghese', 'portoghesi'],
}

export function detectLanguage(userRequest: string): string | null {
  const lower = userRequest.toLowerCase()
  for (const [lang, patterns] of Object.entries(LANGUAGE_PATTERNS)) {
    if (patterns.some(p => lower.includes(p))) {
      return lang
    }
  }
  return null
}

const SEO_KEYWORDS = [
  'seo', 'meta', 'title tag', 'keywords', 'sitemap', 'robots', 'canonical',
  'og:', 'open graph', 'indicizzazione', 'posizionamento', 'ottimizza seo', 'migliora seo',
]

const CREATE_KEYWORDS = [
  'crea', 'genera', 'costruisci', 'fai', 'nuovo sito', 'nuova homepage',
  'rifai', 'ricrea', 'da zero',
]

const DESIGN_UPDATE_KEYWORDS = [
  'colore', 'palette', 'font', 'stile', 'tema', 'sfondo', 'tipografia',
  'restyle', 'cambia aspetto', 'cambia design', 'cambia il colore', 'cambia i colori',
  'cambia font', 'cambia lo stile', 'più moderno', 'più minimal', 'più elegante',
]

const CONTENT_UPDATE_KEYWORDS = [
  'riscrivi', 'riscrivi i testi', 'tono di voce', 'tono più', 'linguaggio',
  'più formale', 'più informale', 'più professionale', 'più amichevole',
  'aggiorna i testi', 'cambia i testi', 'traduci', 'in inglese', 'in italiano',
]

const IMAGES_KEYWORDS = [
  'immagini', 'foto', 'picture', 'image', 'visual', 'grafica',
  'immagine', 'fotografia', 'illustrazione', 'icone', 'copertina',
  'ottimizza immagini', 'migliora immagini', 'cambia foto', 'crea immagini',
  'genera immagini', 'aggiorna foto', 'alt text', 'alt tag', 'didascalia',
]

export function classify(userMessage: string, hasPages: boolean): AgentType {
  const lower = userMessage.toLowerCase()
  // Creazione nuovo sito o nessun sito esistente → pipeline
  if (!hasPages || CREATE_KEYWORDS.some(k => lower.includes(k))) return 'pipeline'
  // Modifica sito — classifica ulteriormente quale tipo
  if (IMAGES_KEYWORDS.some(k => lower.includes(k))) return 'images'
  if (SEO_KEYWORDS.some(k => lower.includes(k))) return 'seo'
  if (DESIGN_UPDATE_KEYWORDS.some(k => lower.includes(k))) return 'design-update'
  if (CONTENT_UPDATE_KEYWORDS.some(k => lower.includes(k))) return 'content-update'
  return 'html'
}

export type PipelineResult = {
  tool: 'create_site'
  input: { pages: Page[]; summary: string }
  agent: 'pipeline' | 'html' | 'design-update' | 'content-update' | 'seo' | 'images'
  steps: string[]
  updatedContext?: ProjectContext
  usage?: object
  requestLanguage?: boolean
}

export async function runDesignUpdate(
  userRequest: string,
  pages: Page[],
  apiKey: string,
  context: ProjectContext = {}
): Promise<PipelineResult> {
  const result = await runDesignAgentUpdate(userRequest, pages, apiKey, context)
  return {
    tool: 'create_site',
    input: { pages: result.pages, summary: `🎨 ${result.summary}` },
    agent: 'design-update',
    steps: [`🎨 Design aggiornato su ${result.pages.length} pagine`],
  }
}

export async function runContentUpdate(
  userRequest: string,
  pages: Page[],
  apiKey: string,
  context: ProjectContext = {}
): Promise<PipelineResult> {
  const result = await runContentAgentUpdate(userRequest, pages, apiKey, context)
  return {
    tool: 'create_site',
    input: { pages: result.pages, summary: `✍️ ${result.summary}` },
    agent: 'content-update',
    steps: [`✍️ Testi aggiornati su ${result.pages.length} pagine`],
  }
}

type EmitFn = (step: string) => void

export async function runFullPipeline(
  userRequest: string,
  existingPages: Page[],
  apiKey: string,
  context: ProjectContext = {},
  emit?: EmitFn
): Promise<PipelineResult> {
  const steps: string[] = []

  // Step 0a: Rileva lingua dal prompt
  const detectedLanguage = detectLanguage(userRequest)
  if (!detectedLanguage && existingPages.length === 0) {
    return {
      tool: 'create_site',
      input: { pages: [], summary: 'Lingua non specificata' },
      agent: 'pipeline',
      steps: ['⚠️ In che lingua vuoi il sito web? (es: italiano, spagnolo, inglese, tedesco, francese, portoghese)'],
      requestLanguage: true,
    }
  }

  // Step 0b: Memory
  const updatedContext = await runMemoryAgent(
    [{ role: 'user', content: userRequest }],
    context,
    apiKey
  ).catch(() => null)
  const activeContext = {
    ...(updatedContext ?? context),
    language: detectedLanguage || context.language || 'it',
  }

  // Step 1: Planner
  emit?.('🗺️ Planner')
  const plan = await runPlanner(userRequest, existingPages, apiKey)
  if (!plan?.pages?.length) throw new Error('Planner non ha prodotto un piano valido')
  steps.push(`✅ Piano: ${plan.pages.map(p => p.slug).join(', ')}`)

  // Step 2a: Site Analyzer
  const urls = extractUrls(userRequest)
  let inspirationBriefs: DesignBrief[] = []
  if (urls.length > 0) {
    emit?.(`🔍 Analisi siti di ispirazione`)
    inspirationBriefs = (await Promise.all(urls.map(url => analyzeSite(url, apiKey)))).filter(Boolean) as DesignBrief[]
  }

  // Step 2b: Content + Design in parallelo
  // Se il contesto ha già un design salvato (sito esistente), riusalo — evita di rigenerare CSS da zero
  const savedDesign = activeContext.design
  const isAddPage = existingPages.length > 0 && !!savedDesign
  emit?.(isAddPage ? '✍️ Content (design dal contesto)' : '✍️ Content + Design')
  const [content, design] = await Promise.all([
    runContentAgent(userRequest, plan, apiKey, activeContext),
    isAddPage
      ? Promise.resolve(savedDesign)
      : runDesignAgent(userRequest, plan, apiKey, activeContext, inspirationBriefs),
  ])
  if (!content?.pages) throw new Error('Content agent non ha prodotto contenuti validi')
  if (!design?.tokens) throw new Error('Design agent non ha prodotto un design valido')

  // Step 3: HTML — usa template se disponibile, altrimenti genera da zero
  const templateName = detectTemplate(plan.businessType)
  const templateHtml = templateName ? loadTemplate(templateName) : null

  emit?.('🏗️ HTML')
  const existingPagesMeta = existingPages.map(p => ({ slug: p.slug, name: p.name }))
  const htmlOutput = templateHtml
    ? await runHtmlAgentFromTemplate(userRequest, plan, content, design, templateHtml, apiKey)
    : await runHtmlAgentWithPlan(userRequest, plan, content, design, apiKey, existingPagesMeta)
  if (!htmlOutput?.pages?.length) throw new Error('HTML agent non ha generato pagine valide')

  // Merge: preserva le pagine esistenti, aggiunge/aggiorna solo le nuove
  const mergedPages = existingPages.length > 0
    ? [
        ...existingPages.filter(ep => !htmlOutput.pages.some(np => np.slug === ep.slug)),
        ...htmlOutput.pages,
      ]
    : htmlOutput.pages

  const newPageSlugs = htmlOutput.pages.map(p => p.slug).filter(s => !existingPages.some(ep => ep.slug === s))
  const summaryNote = newPageSlugs.length > 0
    ? `${htmlOutput.summary} (aggiunt${newPageSlugs.length > 1 ? 'e' : 'a'}: ${newPageSlugs.join(', ')})`
    : htmlOutput.summary

  // Persisti il design nel contesto così i prossimi add-page lo riusano senza chiamare il Design agent
  const finalContext: ProjectContext = {
    ...(updatedContext ?? context),
    design,
  }

  return {
    tool: 'create_site',
    input: { pages: mergedPages, summary: summaryNote },
    agent: 'pipeline',
    steps,
    updatedContext: finalContext,
  }
}
