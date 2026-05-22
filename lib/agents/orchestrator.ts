import { runPlanner } from './planner'
import { runContentAgent, runContentAgentUpdate } from './content-agent'
import { runDesignAgent, runDesignAgentUpdate } from './design-agent'
import { runHtmlAgentWithPlan, runHtmlAgent, runHtmlAgentFromTemplate } from './html-agent'
import { runSeoAgent } from './seo-agent'
import { runImagesAgent } from './images-agent'
import { runAccessibilityAgent } from './accessibility-agent'
import { runMemoryAgent, type ProjectContext } from './memory-agent'
import { analyzeSite, analyzeScreenshots, extractUrls, extractImageUrls, type DesignBrief } from './site-analyzer'
import { generateTemplate, type GeneratedTemplate } from './template-generator'
import { detectTemplate, loadTemplate, TEMPLATE_REGISTRY } from '../templates/index'

/** Rileva se l'utente menziona esplicitamente un template per ID (es: "saas2", "usa il template saas") */
function detectExplicitTemplate(userMessage: string): string | null {
  const lower = userMessage.toLowerCase()
  // Richiede un segnale d'intento esplicito (es: "usa template saas2", "con il template saas")
  // Non deve matchare quando l'ID appare in una descrizione generica (es: "software saas")
  const INTENT_PREFIXES = ['template', 'usa il', 'usa template', 'con template', 'con il template', 'applica template', 'applica il template', 'rifai con', 'rifare con', 'using template']
  const hasIntent = INTENT_PREFIXES.some(p => lower.includes(p))
  if (!hasIntent) return null
  // Ordina per lunghezza decrescente così "saas2" viene trovato prima di "saas"
  const ids = [...TEMPLATE_REGISTRY].sort((a, b) => b.id.length - a.id.length).map(t => t.id)
  for (const id of ids) {
    if (lower.includes(id)) return id
  }
  return null
}

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
  // Frasi specifiche di creazione — NON parole singole generiche come 'fai', 'crea', 'build'
  // che potrebbero matchare richieste di modifica tipo "fai questo header nero"
  'crea un sito', 'crea il sito', 'crea una homepage', 'crea una pagina web',
  'genera un sito', 'genera il sito', 'genera una homepage',
  'costruisci un sito', 'costruisci il sito',
  'fammi un sito', 'fammi una homepage', 'fammi un website',
  'fai un sito', 'fai una homepage', 'fai un website', 'fai da zero',
  'nuovo sito', 'nuova homepage', 'nuovo website',
  'rifai', 'ricrea', 'da zero',
  'make me a', 'make me a website', 'make me a site',
  'create a website', 'create a site', 'create a homepage',
  'build a website', 'build a site',
  'generate a website', 'generate a site',
  'voglio un sito', 'voglio una pagina web', 'voglio un website',
  'ho bisogno di un sito', 'ho bisogno di un website',
  'aggiungi una pagina', 'aggiungi pagina', 'nuova pagina', 'add a page', 'add page',
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
  // Nessun sito esistente → pipeline sempre
  if (!hasPages) return 'pipeline'
  // Template esplicito menzionato → pipeline sempre (il template richiede create_site, non edit_page)
  if (detectExplicitTemplate(userMessage)) return 'pipeline'
  // Sito esistente → pipeline SOLO se la richiesta è esplicitamente di creazione/aggiunta pagina
  if (CREATE_KEYWORDS.some(k => lower.includes(k))) return 'pipeline'
  // Modifica sito — classifica ulteriormente quale tipo
  if (IMAGES_KEYWORDS.some(k => lower.includes(k))) return 'images'
  if (SEO_KEYWORDS.some(k => lower.includes(k))) return 'seo'
  if (DESIGN_UPDATE_KEYWORDS.some(k => lower.includes(k))) return 'design-update'
  if (CONTENT_UPDATE_KEYWORDS.some(k => lower.includes(k))) return 'content-update'
  return 'html'
}

export type PipelineResult = {
  tool: 'create_site'
  input: { pages: Page[]; summary: string; newPageSlugs?: string[] }
  agent: 'pipeline' | 'html' | 'design-update' | 'content-update' | 'seo' | 'images'
  steps: string[]
  updatedContext?: ProjectContext
  usage?: object
  requestLanguage?: boolean
  requestClarification?: boolean
  /** Chiede all'utente di caricare screenshot del sito di ispirazione */
  requestScreenshots?: boolean
  /** URL del sito di ispirazione rilevato nel messaggio */
  inspirationUrl?: string
  /** Template generato da screenshot — da salvare nel DB lato route */
  generatedTemplate?: GeneratedTemplate
}

/** Estrae il design system aggiornato dalle pagine dopo un design-update.
 *  Legge il blocco :root { } dalla home page e aggiorna i token nel contesto. */
function extractUpdatedDesign(pages: Page[], existingDesign?: import('./design-agent').DesignOutput): import('./design-agent').DesignOutput | undefined {
  if (!existingDesign) return undefined
  const home = pages.find(p => p.slug === 'home') ?? pages[0]
  if (!home) return existingDesign
  // Estrai il CSS completo dalla home
  const styleMatch = home.html.match(/<style[\s\S]*?<\/style>/i)
  if (!styleMatch) return existingDesign
  const css = styleMatch[0]
  // Estrai variabili :root
  const rootMatch = css.match(/:root\s*\{([^}]+)\}/i)
  if (!rootMatch) return { ...existingDesign, css }
  const rootVars = rootMatch[1]
  const getVar = (name: string) => {
    const m = rootVars.match(new RegExp(`${name}\\s*:\\s*([^;\\n]+)`))
    return m ? m[1].trim() : undefined
  }
  const updatedTokens = {
    ...existingDesign.tokens,
    colors: {
      ...existingDesign.tokens.colors,
      ...(getVar('--color-accent') ? { primary: getVar('--color-accent')! } : {}),
      ...(getVar('--color-primary') ? { primary: getVar('--color-primary')! } : {}),
      ...(getVar('--color-secondary') ? { secondary: getVar('--color-secondary')! } : {}),
      ...(getVar('--color-bg') ? { background: getVar('--color-bg')! } : {}),
      ...(getVar('--color-background') ? { background: getVar('--color-background')! } : {}),
      ...(getVar('--color-text') ? { text: getVar('--color-text')! } : {}),
    },
    fonts: {
      ...existingDesign.tokens.fonts,
      ...(getVar('--font-heading') ? { heading: getVar('--font-heading')! } : {}),
      ...(getVar('--font-body') ? { body: getVar('--font-body')! } : {}),
    },
  }
  return { ...existingDesign, css, tokens: updatedTokens }
}

export async function runDesignUpdate(
  userRequest: string,
  pages: Page[],
  apiKey: string,
  context: ProjectContext = {}
): Promise<PipelineResult> {
  const result = await runDesignAgentUpdate(userRequest, pages, apiKey, context)
  // Aggiorna il design system nel contesto con i nuovi valori CSS estratti dalle pagine
  const updatedDesign = extractUpdatedDesign(result.pages, context.design)
  const updatedContext: ProjectContext | undefined = updatedDesign
    ? { ...context, design: updatedDesign }
    : undefined
  return {
    tool: 'create_site',
    input: { pages: result.pages, summary: `🎨 ${result.summary}` },
    agent: 'design-update',
    steps: [`🎨 Design aggiornato su ${result.pages.length} pagine`],
    updatedContext,
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

  // Step 0a: Ispirazione URL — gestisci il flusso in due round
  const urls = extractUrls(userRequest)
  const imageUrls = extractImageUrls(userRequest)

  // Round 2: user ha caricato screenshot dopo una richiesta con URL
  // Condizione: context ha lastInspirationUrl + ci sono immagini nel messaggio corrente
  if (context.lastInspirationUrl && imageUrls.length > 0) {
    emit?.('🖼️ Analisi screenshot con Claude Vision')
    const screenshotBrief = await analyzeScreenshots(imageUrls, apiKey).catch(() => null)

    // Rimuovi lastInspirationUrl dal contesto in ogni caso — anche se la Vision fallisce
    const updatedContextAfterTemplate: ProjectContext = { ...context, lastInspirationUrl: undefined }

    if (screenshotBrief) {
      screenshotBrief.sourceUrl = context.lastInspirationUrl
      emit?.('🎨 Generazione template da ispirazione')
      const generatedTemplate = await generateTemplate(screenshotBrief, userRequest, apiKey).catch(() => null)

      return {
        tool: 'create_site',
        input: { pages: existingPages, summary: generatedTemplate
          ? `✨ Template "${generatedTemplate.name}" generato e salvato! Ora genera il tuo sito con "crea un sito per [tipo business]".`
          : '⚠️ Non sono riuscito a generare il template. Prova con "crea un sito" per usare lo stile standard.' },
        agent: 'pipeline',
        steps: generatedTemplate
          ? [`✅ Template "${generatedTemplate.name}" (settore: ${generatedTemplate.sector}) salvato`]
          : ['⚠️ Generazione template fallita'],
        updatedContext: updatedContextAfterTemplate,
        generatedTemplate: generatedTemplate ?? undefined,
      }
    }

    // Vision fallita — informa l'utente ma pulisci il contesto
    return {
      tool: 'create_site',
      input: { pages: existingPages, summary: '⚠️ Non ho potuto analizzare gli screenshot (potrebbero essere troppo grandi o in formato non supportato). Puoi comunque generare il sito con "crea un sito per [tipo business]".' },
      agent: 'pipeline',
      steps: ['⚠️ Analisi screenshot fallita'],
      updatedContext: updatedContextAfterTemplate,
    }
  }

  // Round 1: user ha incollato un URL ma nessuno screenshot ancora
  // Condizione: c'è un URL nel messaggio E non ci sono immagini E non è già stato salvato lastInspirationUrl
  if (urls.length > 0 && imageUrls.length === 0 && !context.lastInspirationUrl) {
    const inspirationUrl = urls[0]
    emit?.(`🔍 Analisi sito: ${inspirationUrl}`)

    // Analizza CSS/HTML in background (usiamo il brief per il design, non per fermare il pipeline)
    // Salviamo l'URL nel contesto per abbinarlo agli screenshot nel round successivo
    const cssAnalysis = await analyzeSite(inspirationUrl, apiKey).catch(() => null)

    // Aggiorna contesto con lastInspirationUrl per riconoscere gli screenshot nel round successivo
    const updatedContextWithInspiration: ProjectContext = {
      ...context,
      lastInspirationUrl: inspirationUrl,
    }

    const screenshotMsg = `🎨 Ho analizzato il design di ${inspirationUrl}.

Per generare un template fedele a questo stile, ho bisogno di vedere il sito visivamente. Carica 2-3 screenshot della homepage e delle sezioni che ti piacciono di più (usa il pulsante 📎 nella chat).

Nel frattempo, dimmi: che tipo di business vuoi creare e come si chiama?`

    return {
      tool: 'create_site',
      input: { pages: existingPages, summary: screenshotMsg },
      agent: 'pipeline',
      steps: [`🔍 Sito analizzato: ${inspirationUrl}${cssAnalysis ? ' (design estratto)' : ''}`],
      updatedContext: updatedContextWithInspiration,
      requestScreenshots: true,
      inspirationUrl,
    }
  }

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
    // Se il sito esiste già, la lingua è sempre quella salvata nel contesto — NON quella rilevata
    // dal messaggio dell'utente (che scrive in italiano anche se il sito è in spagnolo).
    // Solo alla prima creazione usiamo la lingua rilevata dal prompt.
    language: existingPages.length > 0
      ? (context.language || (updatedContext as { language?: string } | null)?.language || 'it')
      : (detectedLanguage || context.language || 'it'),
  }

  // Step 1: Planner — aggiungi lingua al prompt se non rilevabile dal testo
  emit?.('🗺️ Planner')
  const plannerRequest = activeContext.language && activeContext.language !== 'it'
    ? `[LINGUA DEL SITO: ${activeContext.language}]\n${userRequest}`
    : userRequest
  const plan = await runPlanner(plannerRequest, existingPages, apiKey)
  if (!plan?.pages?.length) throw new Error('Planner non ha prodotto un piano valido')
  steps.push(`✅ Piano: ${plan.pages.map(p => p.slug).join(', ')}`)

  // Step 2a: Site Analyzer — analizza URL di ispirazione (se presenti e non già gestiti in cima)
  // `urls` è già estratto in cima alla funzione; qui lo riusiamo solo per la design inspiration
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

  // Step 3: HTML — usa template se: (a) richiesto esplicitamente per ID, (b) prima run con business type matching
  // Combina il messaggio originale + businessType del planner per massimizzare il rilevamento keyword
  const explicitTemplate = detectExplicitTemplate(userRequest)
  const templateName = explicitTemplate ?? (existingPages.length === 0
    ? (detectTemplate(`${userRequest} ${plan.businessType}`) ?? null)
    : null)
  const templateHtml = templateName ? loadTemplate(templateName) : null

  emit?.('🏗️ HTML')
  const existingPagesMeta = existingPages.map(p => ({ slug: p.slug, name: p.name }))
  const htmlOutput = templateHtml
    ? await runHtmlAgentFromTemplate(userRequest, plan, content, design, templateHtml, apiKey, activeContext.language ?? 'it')
    : await runHtmlAgentWithPlan(userRequest, plan, content, design, apiKey, existingPagesMeta)
  if (!htmlOutput?.pages?.length) throw new Error('HTML agent non ha generato pagine valide')

  // Normalize slugs: models sometimes return './' or '/' for home → always use 'home'
  htmlOutput.pages = htmlOutput.pages.map(p => ({
    ...p,
    slug: p.slug === './' || p.slug === '/' || p.slug === '' ? 'home' : p.slug.replace(/^\/|\/$/g, ''),
  }))

  // Sync navbar: estrai la navbar dalla prima nuova pagina (che ha già tutti i link corretti)
  // e applicala a tutte le pagine esistenti così la voce di menu appare ovunque
  const updatedExistingPages = (() => {
    if (existingPages.length === 0 || htmlOutput.pages.length === 0) return existingPages
    const navMatch = htmlOutput.pages[0].html.match(/<nav[\s\S]*?<\/nav>/i)
    if (!navMatch) return existingPages
    const newNav = navMatch[0]
    return existingPages.map(p => ({
      ...p,
      html: p.html.replace(/<nav[\s\S]*?<\/nav>/i, newNav),
    }))
  })()

  // Merge: preserva le pagine esistenti (con navbar aggiornata), aggiunge/aggiorna solo le nuove
  const mergedPages = existingPages.length > 0
    ? [
        ...updatedExistingPages.filter(ep => !htmlOutput.pages.some(np => np.slug === ep.slug)),
        ...htmlOutput.pages,
      ]
    : htmlOutput.pages

  const newPageSlugs = htmlOutput.pages.map(p => p.slug).filter(s => !existingPages.some(ep => ep.slug === s))
  const summaryNote = newPageSlugs.length > 0
    ? `${htmlOutput.summary} (aggiunt${newPageSlugs.length > 1 ? 'e' : 'a'}: ${newPageSlugs.join(', ')})`
    : htmlOutput.summary

  // Persisti design e lingua nel contesto così le run successive li ereditano
  const finalContext: ProjectContext = {
    ...(updatedContext ?? context),
    design,
    language: activeContext.language,
  }

  return {
    tool: 'create_site',
    input: { pages: mergedPages, summary: summaryNote, newPageSlugs },
    agent: 'pipeline',
    steps,
    updatedContext: finalContext,
  }
}
