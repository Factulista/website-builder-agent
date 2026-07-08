import { NextRequest } from 'next/server'
type AgentType = 'html'
import { runHtmlAgent } from '../../../lib/agents/html-agent'
import { runMemoryAgent, runSessionMemoryAgent, compactSessionMemory, shouldCompactMemory, type ProjectContext } from '../../../lib/agents/memory-agent'
import { getAgentConfigs, type DbAgentConfig } from '../../../lib/agents/db-config'
import { applyDbOverrides, AGENT_CONFIGS } from '../../../lib/agents/config'
import { startRun, completeRun, failRun, noActionRun } from '../../../lib/agents/run-logger'
import { findComponentByKeywords } from '../../../lib/components/index'
import { requireUserAndProject, jsonError, ApiError } from '../../../lib/api-auth'
import { precheckCredits, consumeCredits, CreditsError, AnthropicBillingError } from '../../../lib/credits'
import { detectLangFromText } from '../../../lib/agents/detect-lang'
import { checkHtmlQuality, reconstructEditedHtml, formatReportForAgent, applyEditValidated } from '../../../lib/agents/html-quality'
import { splitHtmlIntoBlocks, assembleBlocksToHtml, findBlockBySelector, editBlock as editBlockFn } from '../../../lib/agents/block-splitter'
import { runRulesLearner, quickLearnRules } from '../../../lib/agents/rules-learner'
import { DEFAULT_FACTULISTA_RULES, formatRulesForAgent, type ProjectRules } from '../../../lib/agents/project-rules'
import { extractDesignSystem, buildDesignSystemBlock, mergeDesignSystemIntoSharedCss } from '../../../lib/agents/design-extractor'

type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } | undefined
function totalTokens(u: Usage): number {
  return (u?.input_tokens ?? 0) + (u?.output_tokens ?? 0)
}

export const runtime = 'nodejs'
export const maxDuration = 300

type Page = { slug: string; name: string; html: string; blocks?: import('../../../lib/types').Block[] }

/**
 * normalizeInternalLinks — post-processing step that runs after every agent operation.
 *
 * The LLM often generates absolute links like href="/precios" or href="precios"
 * instead of the correct relative href="./precios". Since the preview is served
 * under a base path (e.g. /preview/{slug}/), absolute links navigate to the wrong
 * place and relative links without "./" may also break.
 *
 * This function:
 * 1. Converts href="/slug" → href="./slug" for all known page slugs
 * 2. Converts href="slug" (bare, no slash) → href="./slug"
 * 3. Converts href="/home" or href="/" → href="./"
 * 4. Leaves external links (http/https/mailto/tel/#) untouched
 */
function normalizeInternalLinks(pages: Page[]): Page[] {
  const slugs = new Set(pages.map(p => p.slug))

  return pages.map(page => {
    let html = page.html

    // Fix absolute paths: href="/precios" → href="./precios"
    // and href="/home" or href="/" → href="./"
    html = html.replace(/href="\/([^"#?]*)"/g, (match, path) => {
      if (!path || path === 'home') return 'href="./"'
      const slug = path.replace(/\/$/, '')
      if (slugs.has(slug)) return `href="./${slug}"`
      return match // unknown path — leave as-is
    })

    // Fix bare slugs without dot-slash: href="precios" → href="./precios"
    // Only for known slugs, to avoid breaking real external refs
    for (const slug of slugs) {
      if (slug === 'home') continue
      // href="slug" but NOT href="./slug" or href="http..." or href="#..."
      html = html.replace(
        new RegExp(`href="${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g'),
        `href="./${slug}"`
      )
    }

    // href="./home" → href="./" (home is always the root)
    html = html.replace(/href="\.\/home"/g, 'href="./"')

    return { ...page, html }
  })
}

type ProgressMessage = {
  type: 'progress'
  step: string
  time: string
  tokens: number
}

type DoneMessage = {
  type: 'done'
  result: object
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`
}

function encodeMessage(msg: ProgressMessage | DoneMessage): string {
  return JSON.stringify(msg) + '\n'
}

/**
 * makeStream — wraps any async agent fn in a streaming NDJSON response.
 *
 * The fn receives an `emit(step)` callback to push progress events.
 * When the fn resolves, a `{ type: 'done', result }` event is emitted.
 * Errors are emitted as `{ type: 'error', error }` and the stream is closed.
 */
function makeStream(
  fn: (emit: (step: string) => void) => Promise<object>,
  onError?: (err: unknown) => void
): Response {
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  const startTime = Date.now()

  const stream = new ReadableStream<Uint8Array>({
    start(c) { controller = c },
  })

  const emit = (step: string) => {
    if (!controller) return
    const msg: ProgressMessage = { type: 'progress', step, time: formatTime(Date.now() - startTime), tokens: 0 }
    controller.enqueue(encoder.encode(encodeMessage(msg)))
  }

  fn(emit)
    .then((result) => {
      const done: DoneMessage = { type: 'done', result }
      controller?.enqueue(encoder.encode(encodeMessage(done)))
      controller?.close()
    })
    .catch((err) => {
      console.error('[makeStream] CRASH:', String(err), err instanceof Error ? err.stack?.slice(0, 500) : '')
      onError?.(err)
      const error = { type: 'error', error: String(err) }
      controller?.enqueue(encoder.encode(JSON.stringify(error) + '\n'))
      controller?.close()
    })

  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } })
}

/**
 * Session compaction — prevents context overflow on long conversations.
 * Keeps the first message (setup context) + last N messages.
 * Middle messages are summarised into a single assistant note.
 */
function compactMessages(
  messages: { role: string; content: string }[]
): { role: string; content: string }[] {
  const MAX_CHARS = 120_000 // ~30k tokens — leave headroom for system prompt + response
  const total = messages.reduce((s, m) => s + (typeof m.content === 'string' ? m.content.length : 0), 0)
  if (total <= MAX_CHARS) return messages

  const TAIL = 12 // always keep last 12 messages verbatim
  const head = messages.slice(0, 1)  // first message = initial context
  const tail = messages.slice(-TAIL)
  const middle = messages.slice(1, -TAIL)

  if (middle.length === 0) return messages

  // Summarise middle: extract page slugs mentioned, key decisions
  const pageRefs = [...new Set(middle.flatMap(m =>
    (typeof m.content === 'string' ? m.content.match(/slug[": ]+(\w[-\w]*)/g) ?? [] : [])
  ))].join(', ')
  const summary = `[Riepilogo automatico di ${middle.length} messaggi precedenti]
Pagine modificate/menzionate: ${pageRefs || 'varie'}
Nota: per dettagli su queste operazioni, consulta la cronologia completa.`

  return [
    ...head,
    { role: 'assistant', content: summary },
    ...tail,
  ]
}

export async function POST(req: NextRequest) {
  // Declared outside try so the catch block can call failRun on any error
  let runId = ''
  let runStartTime = Date.now()

  try {
    const { projectId, messages: rawMessages, pages, activePageSlug, customDomain, previewSelection, visibleBlocks, seoKeywords } = await req.json() as {
      projectId: string
      messages: { role: string; content: string }[]
      pages: Page[]
      activePageSlug: string | null
      seoKeywords?: Array<{keyword:string;volume:number;difficulty:number;intent?:string}>
      customDomain?: string | null
      previewSelection?: { blockSelector: string; anchorText: string; outerHtml: string } | null
      visibleBlocks?: string[]
    }

    // Apply compaction before passing to agents
    const messages = compactMessages(rawMessages)

    // ── Ensure blocks are always present server-side ──────────────────────────
    if (pages) {
      try {
        for (let i = 0; i < pages.length; i++) {
          if (!pages[i].blocks || pages[i].blocks!.length === 0) {
            const blocks = splitHtmlIntoBlocks(pages[i].html)
            if (blocks) pages[i] = { ...pages[i], blocks }
          }
        }
        const withBlocks = pages.filter(p => (p.blocks?.length ?? 0) > 0).length
        console.log(`[blocks] ${withBlocks}/${pages.length} pages have blocks`)
      } catch (e) {
        console.error('[blocks] split failed:', e instanceof Error ? e.message : e)
      }
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })

    // Auth + ownership + credits pre-check
    const { user, supabase, project } = await requireUserAndProject(req, projectId)
    await precheckCredits(user.id, supabase)

    /** Fire-and-forget credit consumption from an LLM usage object. */
    const consumeUsage = (usage: Usage, model?: string) => {
      const t = totalTokens(usage)
      if (t <= 0) return
      consumeCredits(user.id, t, 'chat', projectId, {
        input: usage?.input_tokens ?? 0,
        output: usage?.output_tokens ?? 0,
        cache_read: usage?.cache_read_input_tokens ?? 0,
        model,
      }, supabase).catch((e: unknown) => console.error('[credits] consume failed:', e))
    }

    // Load DB agent configs and apply overrides (non-blocking fallback)
    let dbConfigs: DbAgentConfig[] = []
    try {
      dbConfigs = await getAgentConfigs()
      applyDbOverrides(dbConfigs)
    } catch {
      // Fall back to hardcoded configs if DB is unavailable
    }

    const siteConfig = (project?.site_config ?? {}) as Record<string, unknown>
    const context: ProjectContext = (siteConfig.context as ProjectContext) ?? {}
    const mediaMeta = (siteConfig.media ?? {}) as Record<string, { alt?: string; title?: string }>
    const designSystem = (siteConfig.designSystem ?? null) as Record<string, { fontSize?: string; fontWeight?: string; color?: string; lineHeight?: string; fontFamily?: string }> | null
    const sharedCss = (siteConfig.shared_css ?? '') as string
    let sessionMemory = (siteConfig.sessionMemory as string | undefined) ?? ''

    // Fase 3d: compact session memory on long sessions (>40 msgs, memory >2k chars)
    // Run synchronously before the agent so it gets the compacted version immediately.
    if (shouldCompactMemory(messages, sessionMemory)) {
      const compacted = await compactSessionMemory(sessionMemory, apiKey).catch(() => null)
      if (compacted) {
        sessionMemory = compacted
        // Persist compacted memory in background (non-blocking)
        void (async () => {
          try {
            const { data: fresh } = await supabase.from('projects').select('site_config').eq('id', projectId).single()
            const freshConfig = (fresh?.site_config as Record<string, unknown>) ?? {}
            await supabase.from('projects').update({
              site_config: { ...freshConfig, sessionMemory: compacted },
            }).eq('id', projectId)
          } catch { /* non-critical */ }
        })()
      }
    }

    // Load or learn project-specific rules
    let projectRules: ProjectRules = (siteConfig.projectRules as ProjectRules) ?? { ...DEFAULT_FACTULISTA_RULES }
    // If rules not stored yet, quick-learn from existing pages (async, non-blocking)
    if (!siteConfig.projectRules && (pages ?? []).length > 0) {
      // Fire-and-forget: learn and save rules in background
      runRulesLearner({ pages: pages ?? [], context })
        .then(result => {
          return supabase.from('projects').update({
            site_config: { ...siteConfig, projectRules: result.rules },
          }).eq('id', projectId)
        })
        .catch(() => {/* non-blocking error */ })
      // Use quick-learned rules for this request (doesn't wait for full learn)
      const quickLearned = quickLearnRules((pages ?? []))
      projectRules = { ...projectRules, ...quickLearned }
    }

    // Load recent blog posts for tone-of-voice context (non-blocking, max 3)
    let blogPosts: Array<{ title: string; content_html: string }> = []
    try {
      const { data: bps } = await supabase
        .from('blog_posts')
        .select('title, content_html')
        .eq('project_id', projectId)
        .not('content_html', 'is', null)
        .order('published_at', { ascending: false })
        .limit(3)
      blogPosts = bps ?? []
    } catch { /* non-critical */ }

    // List project media so agents can reference user-uploaded images
    // List project media for agent context — capped at 5s timeout so a slow
    // Supabase storage response never blocks the chat API from starting.
    let projectMedia: Array<{ url: string; name: string; alt?: string; title?: string }> = []
    if (project?.user_id) {
      try {
        const folder = `${project.user_id}/${projectId}`
        const mediaListPromise = supabase.storage.from('project-assets').list(folder, { limit: 100 })
        const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000))
        const result = await Promise.race([mediaListPromise, timeoutPromise])
        const files = result && 'data' in result ? result.data : null
        if (files) {
          projectMedia = files
            .filter(f => f.name && f.metadata)
            .map(f => {
              const path = `${folder}/${f.name}`
              const url = supabase.storage.from('project-assets').getPublicUrl(path).data.publicUrl
              const meta = mediaMeta[path] || {}
              return { url, name: f.name, alt: meta.alt, title: meta.title }
            })
        }
      } catch {
        // Storage unavailable — proceed without media list (agent will work without image refs)
        console.warn('[chat] storage list timed out or failed — continuing without media')
      }
    }

    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content ?? ''
    // Detect the language the user is writing in RIGHT NOW (per-message, not accumulated)
    const userLang = detectLangFromText(lastUserMessage)
    // Site language: stored in project context — never changes based on user's input language
    const siteLang = (context.language as string | undefined) ?? userLang

    // Cleanup zombie runs older than 10 min (fire-and-forget, non-blocking)
    void supabase.from('agent_runs')
      .update({ status: 'error', error_message: 'Timeout: run non completata entro 10 minuti' })
      .eq('status', 'running')
      .lt('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())

    // Single master agent: HTML Agent handles everything
    // - Creates new sites from scratch (create_site tool)
    // - Modifies existing pages (edit_page, add_page, delete_page tools)
    // - Can use available templates if provided
    // - Can analyze inspiration URLs/screenshots if available
    const agent: AgentType = 'html'

    // Check if the html agent is disabled
    if (dbConfigs.length > 0) {
      const htmlConfig = dbConfigs.find(c => c.name === 'html')
      if (htmlConfig && !htmlConfig.enabled) {
        return Response.json(
          { error: 'L\'agente HTML è attualmente disabilitato. Riprova più tardi.' },
          { status: 503 }
        )
      }
    }

    // Logging setup — non-blocking
    runStartTime = Date.now()
    const agentModel = dbConfigs.find(c => c.name === agent)?.model ?? AGENT_CONFIGS[agent]?.model ?? ''

    // Build structured input_data for debugging
    const isDeleteMsg = /\b(elimina|rimuovi|cancella|togli|delete|remove|quita|borra|supprime|lösche)\b/i.test(lastUserMessage)
    const isMicroEditMsg = isDeleteMsg || /\b(bordes?\s+redondeados?|border.radius|arrotonda|rounded|bold|grassetto|sottolineato|underline|font.size)\b/i.test(lastUserMessage)
    const isColorMsg = /\b(color|colou?r|sfondo|background|tint|palette|gradiente|gradient|rgba?|hex|#[0-9a-f]{3,6})\b/i.test(lastUserMessage)
    const isAddPageMsg = /\b(add_page|nuova pagina|nueva página|new page|aggiungi pagina|añade página)\b/i.test(lastUserMessage)
    const hasImageInMsg = /Immagine allegata:\s*https?:\/\//i.test(lastUserMessage)
    const isTranslateMsgForLog = /\b(traduci|translate|traduzione|in italiano|in inglese|in spagnolo|in español|in english|in tedesco|in francese|in portoghese)\b/i.test(lastUserMessage)
    // Component injection is only meaningful when editing existing pages. On a brand-new
    // site (no pages yet) the agent must design the whole thing via create_site — injecting
    // a single library component would derail generation (e.g. "5 stelle" → testimonial grid).
    const hasExistingPages = (pages?.length ?? 0) > 0
    const matchedComponentForLog = (isDeleteMsg || isTranslateMsgForLog || !hasExistingPages) ? null : findComponentByKeywords(lastUserMessage)

    const activePage = (pages ?? []).find(p => p.slug === activePageSlug) ?? (pages ?? [])[0] ?? null
    const pagesContextLog = (pages ?? []).map(p => {
      const isActive = p.slug === activePage?.slug
      let mode: 'active_full' | 'active_skeleton' | 'active_micro' | 'mentioned' | 'listed' = 'listed'
      if (isActive) {
        mode = isMicroEditMsg && !hasImageInMsg ? 'active_micro' : isColorMsg ? 'active_full' : 'active_skeleton'
      } else {
        const wordBound = (term: string) => new RegExp(`(?<![a-z0-9])${term.replace(/[-]/g, '[\\-]')}(?![a-z0-9])`, 'i').test(lastUserMessage)
        if (!isDeleteMsg && (wordBound(p.slug) || wordBound(p.name))) mode = 'mentioned'
      }
      return { slug: p.slug, token_estimate: Math.round(p.html.length / 4), mode }
    })

    try {
      runId = await startRun({
        project_id: projectId,
        user_id: project?.user_id ?? undefined,
        agent_type: agent,
        input_summary: lastUserMessage.slice(0, 300),
        model: agentModel,
        input_data: {
          user_message: lastUserMessage,
          pages_context: pagesContextLog,
          micro_edit: isMicroEditMsg && !hasImageInMsg,
          has_image: hasImageInMsg,
          is_delete: isDeleteMsg,
          is_color_request: isColorMsg,
          is_add_page: isAddPageMsg,
          component_matched: matchedComponentForLog?.name ?? null,
          agent_routed: agent,
        },
      })
    } catch (runErr) {
      console.error('[run-logger] startRun failed:', String(runErr))
    }

    // HTML agent — also update context from conversation
    return makeStream(async (emit) => {
      emit('✏️ Elaborando la modifica…')
      const contextLogo = context.design?.tokens?.logo

      // Enrich messages with component HTML if user referenced a library component.
      // Skip on delete/remove requests: keyword fires on subject of deletion
      // (e.g. "elimina Funcionalidades" → matches mega-menu component tag)
      // Skip on translate requests: "traduci in italiano" should not inject component HTML
      // Skip on duplicate/copy/rename requests: "duplica Funcionalidades" must not inject
      // the mega-menu component just because "funcionalidades" is in its tags.
      const isDeleteMsg = /\b(elimina|rimuovi|cancella|togli|delete|remove|quita|borra|supprime|lösche)\b/i.test(lastUserMessage)
      const isTranslateMsg = /\b(traduci|translate|traduzione|in italiano|in inglese|in spagnolo|in español|in english|in tedesco|in francese|in portoghese|in francese)\b/i.test(lastUserMessage)
      const isDuplicateMsg = /\b(duplica|duplic|copia|clona|clone|crea.*copiando|duplicar|copiar|cloner|kopier)\b/i.test(lastUserMessage)
      // Skip component injection on brand-new sites (no pages) — see hasExistingPages above.
      const matchedComponent = (isDeleteMsg || isTranslateMsg || isDuplicateMsg || !hasExistingPages) ? null : findComponentByKeywords(lastUserMessage)
      const agentMessages = matchedComponent
        ? messages.map((m, i) => i === messages.length - 1
            ? {
                ...m,
                content: m.content +
                  `\n\n[COMPONENTE DA LIBRERIA — usa questo HTML come base, adattalo al design del sito]\nNome: ${matchedComponent.name}\n\`\`\`html\n${matchedComponent.html}\n\`\`\``,
              }
            : m)
        : messages

      const injectPoints = (siteConfig.inject_points ?? {}) as Record<string, string>

      // Run agent with quality feedback loop (max 1 retry on critical issues)
      let result = await runHtmlAgent(
        agentMessages, pages ?? [], activePageSlug, apiKey,
        projectMedia, contextLogo, injectPoints, userLang, siteLang, context,
        { pages: pages ?? [], designSystem: designSystem ?? undefined, sharedCss: sharedCss ?? undefined, blogPosts, projectRules, sessionMemory: sessionMemory || undefined, seoKeywords: seoKeywords ?? undefined },
        previewSelection ?? undefined,
        visibleBlocks ?? undefined
      )

      // ── Fase 1: Handle edit_block / replace_block ────────────────────────────
      // These tools operate on a single block. We:
      //  1. Apply the change to the block
      //  2. Reassemble full page HTML from blocks
      //  3. Normalise result to an edit_page result so the rest of the pipeline
      //     (quality check, save, memory) works without modification.
      if (result.tool === 'edit_block' || result.tool === 'replace_block') {
        const pageSlug = String(result.input?.pageSlug ?? activePageSlug ?? '')
        const targetPage = (pages ?? []).find(p => p.slug === pageSlug)
        const selector = String(result.input?.blockSelector ?? '')

        if (targetPage && selector) {
          // Ensure blocks exist for this page
          const blocks = targetPage.blocks ?? splitHtmlIntoBlocks(targetPage.html) ?? []
          const block = findBlockBySelector(blocks, selector)

          if (!block) {
            result = { ...result, tool: 'edit_page', input: { ...(result.input ?? {}), pageSlug, summary: `⚠️ Blocco "${selector}" non trovato. Prova con read_block per vedere i blocchi disponibili.`, edits: [], operations: [] } }
          } else if (result.tool === 'edit_block') {
            const find = String(result.input?.find ?? '')
            const replace = String(result.input?.replace ?? '')
            console.log(`[edit_block] selector="${selector}" find="${find.slice(0,50)}..." replace="${replace.slice(0,50)}..."`)
            const editResult = editBlockFn(block, find, replace)
            if (!editResult.ok) {
              console.warn(`[edit_block] FAILED: matches=${editResult.matches} on selector="${selector}"`)
              const hint = editResult.matches === 0
                ? `non trovato${editResult.hint ? ` — riga simile: "${editResult.hint}"` : ''}`
                : `${editResult.matches} occorrenze — allunga l'ancora`
              result = { ...result, tool: 'edit_page', input: { ...(result.input ?? {}), pageSlug, summary: `⚠️ edit_block fallito su "${selector}": ${hint}. Usa read_block per ottenere i byte esatti.`, edits: [], operations: [] } }
            } else {
              // Apply: update blocks array + reassemble HTML
              const updatedBlocks = blocks.map(b => b.id === block.id ? editResult.block : b)
              const newHtml = assembleBlocksToHtml(updatedBlocks, targetPage.html)
              result = { ...result, tool: 'edit_page', input: { pageSlug, summary: result.input?.summary, edits: [{ find: targetPage.html, replace: newHtml }], operations: [], _blocks: updatedBlocks, _blockSelector: block.selector, _blockHtml: editResult.block.html } }
            }
          } else {
            // replace_block: full block replacement
            const newBlockHtml = String(result.input?.html ?? '')
            const updatedBlocks = blocks.map(b => b.id === block.id ? { ...b, html: newBlockHtml } : b)
            const newHtml = assembleBlocksToHtml(updatedBlocks, targetPage.html)
            result = { ...result, tool: 'edit_page', input: { pageSlug, summary: result.input?.summary, edits: [{ find: targetPage.html, replace: newHtml }], operations: [], _blocks: updatedBlocks, _blockSelector: block.selector, _blockHtml: newBlockHtml } }
          }
        }
      }

      // Quality check loop: if critical issues found, retry once with feedback
      let qualityRetried = false
      if ((result.tool === 'edit_page' || result.tool === 'create_site') && !qualityRetried) {
        emit('🔍 Verificando qualità HTML…')

        // Reconstruct final HTML from operations/edits
        let htmlToCheck = ''
        let checkPages = pages ?? []

        if (result.tool === 'create_site' && result.input?.pages) {
          checkPages = result.input.pages as Page[]
          htmlToCheck = checkPages.map(p => p.html).join('\n')
        } else if (result.tool === 'edit_page') {
          const targetPage = (pages ?? []).find(p => p.slug === (result.input?.pageSlug as string))
          if (targetPage) {
            const ops = (result.input?.operations ?? []) as Array<{op: 'insert_after'|'insert_before'|'replace'; target: string; html: string}>
            const edits = (result.input?.edits ?? []) as Array<{find: string; replace: string}>
            htmlToCheck = reconstructEditedHtml(targetPage.html, ops, edits)
          }
        }

        const report = checkHtmlQuality(htmlToCheck, checkPages)

        if (report.critical.length > 0) {
          emit(`⚠️ Correggo ${report.critical.length} problema/i rilevato/i…`)

          // Format feedback and retry agent once
          const feedbackMsg = formatReportForAgent(report, (result.input?.pageSlug || result.input?.slug || 'sconosciuta') as string)
          const correctionMessages = [
            ...agentMessages,
            { role: 'assistant', content: JSON.stringify(result) },
            { role: 'user', content: feedbackMsg },
          ]

          // Retry with correction feedback
          result = await runHtmlAgent(
            correctionMessages, pages ?? [], activePageSlug, apiKey,
            projectMedia, contextLogo, injectPoints, userLang, siteLang, context,
            { pages: pages ?? [], designSystem: designSystem ?? undefined, sharedCss: sharedCss ?? undefined, blogPosts, projectRules, sessionMemory: sessionMemory || undefined, seoKeywords: seoKeywords ?? undefined }
          )
          qualityRetried = true
        }
      }

      // ── Fase 4: handle run_seo_audit tool ────────────────────────────────────
      if (result.tool === 'run_seo_audit') {
        const { compileSeo: cSeo, formatSeoReport: fSeo } = await import('../../../lib/seo-compiler')
        const seoReport = cSeo(pages ?? [], { customDomain: customDomain ?? undefined })
        const reportText = fSeo(seoReport)
        const applyFixes = result.input?.applyFixes as boolean ?? false

        if (applyFixes && seoReport.blockingIssues.length > 0) {
          // Feed SEO report back as an edit_page correction request
          const fixPrompt = `SEO AUDIT COMPLETATO. Score: ${seoReport.score}/100.\n\n${reportText}\n\nApplica le correzioni critiche ai tag <head> delle pagine interessate usando edit_page.`
          result = { ...result, tool: 'edit_page', input: { pageSlug: (pages ?? [])[0]?.slug ?? '', summary: fixPrompt, edits: [], operations: [], _seoReport: seoReport } }
        } else {
          // Just return the report as a summary (no HTML change)
          result = { ...result, tool: 'edit_page', input: { pageSlug: (pages ?? [])[0]?.slug ?? '', summary: `📊 ${reportText}`, edits: [], operations: [] } }
        }
      }

      // ── Fase 4: handle update_design tool ────────────────────────────────────
      if (result.tool === 'update_design') {
        const newCss = result.input?.css as string | undefined
        if (newCss) {
          // Direct CSS provided: save as shared_css immediately
          result = { ...result, tool: 'edit_page', input: { pageSlug: (pages ?? [])[0]?.slug ?? '', summary: result.input?.summary ?? '🎨 Design aggiornato', edits: [], operations: [], _shared_css: newCss } }
        } else {
          // Delegate to design agent (changes description only)
          const { runDesignAgentUpdate } = await import('../../../lib/agents/design-agent')
          const designResult = await runDesignAgentUpdate(String(result.input?.changes ?? ''), siteConfig.shared_css as string ?? '', apiKey, context)
          result = { ...result, tool: 'edit_page', input: { pageSlug: (pages ?? [])[0]?.slug ?? '', summary: `🎨 ${designResult.summary}`, edits: [], operations: [], _shared_css: designResult.css } }
        }
      }

      // Normalize internal links on create_site and add_page (edit_page is fine — it's surgical)
      if (result.tool === 'create_site' && result.input?.pages) {
        result.input.pages = normalizeInternalLinks(result.input.pages as Page[])
      }
      if (result.tool === 'add_page' && result.input?.html) {
        const normalized = normalizeInternalLinks([{ slug: result.input.slug as string, name: result.input.name as string, html: result.input.html as string }, ...(pages ?? [])])
        result.input.html = normalized[0].html
      }

      // ── Agent → Platform: sync Design System after site creation ──────────
      // When the agent generates a new site, extract typography + palette from
      // the home page HTML and write back to siteConfig so the platform's
      // Design System panel reflects what the agent created.
      // Only on create_site: edit_page is surgical and shouldn't reset the DS.
      if (result.tool === 'create_site' && result.input?.pages) {
        const newPages = result.input.pages as Page[]
        const homePage = newPages.find((p: Page) => p.slug === 'home') ?? newPages[0]
        // Auto-populate the Design System ONLY on the very first site creation, when the
        // user has not yet set one. If designSystem already exists, it is the authoritative
        // source — we must NOT touch designSystem OR the DS block in shared_css, otherwise
        // the panel (reads designSystem) and the blog (reads shared_css) diverge.
        const userHasCustomDS = !!siteConfig.designSystem
        if (homePage?.html && !userHasCustomDS) {
          const extracted = extractDesignSystem(homePage.html)
          const dsBlock = buildDesignSystemBlock(extracted)
          const freshSharedCss = sharedCss || ''
          const newSharedCss = mergeDesignSystemIntoSharedCss(freshSharedCss, dsBlock)
          const { cssVars: _vars, googleFonts: _fonts, ...dsToSave } = extracted
          Promise.resolve(
            supabase.from('projects').select('site_config').eq('id', projectId).single()
          ).then(async ({ data: fresh }) => {
            const freshConfig = (fresh?.site_config as Record<string, unknown>) ?? siteConfig
            // Re-check inside the async block — another request may have set DS meanwhile
            if (freshConfig.designSystem) return
            await supabase.from('projects').update({
              site_config: { ...freshConfig, designSystem: dsToSave, shared_css: newSharedCss },
            }).eq('id', projectId)
          }).catch(() => null)
        }
      }

      const htmlUsage = result.usage as Usage
      consumeUsage(htmlUsage)

      // Server-side html_changed detection: if edit_page returned zero ops AND zero edits
      // AND zero typed_edits → the agent found nothing to apply (element not found, text mismatch).
      const opsCount        = (result.input?.operations  as unknown[])?.length ?? 0
      const editsCount      = (result.input?.edits        as unknown[])?.length ?? 0
      const typedEditsCount = (result.input?.typed_edits  as unknown[])?.length ?? 0
      // Log typed_edits usage so we can verify the feature is being adopted
      if (typedEditsCount > 0) {
        const types = (result.input?.typed_edits as Array<{type: string}>).map(e => e.type).join(',')
        console.log(`[typed_edits] ${agentModel} used ${typedEditsCount} typed_edits (${types}) — saved ~${(opsCount + editsCount) * 500} tokens vs HTML generation`)
      }
      const isNoAction = result.tool === 'edit_page' && opsCount === 0 && editsCount === 0 && typedEditsCount === 0
      const serverHtmlChanged = isNoAction ? false : undefined // unknown until client applies edits

      if (runId) {
        if (isNoAction) {
          // Mark as no_action so back-office stats are accurate
          noActionRun(runId, {
            reason: `Elemento non trovato nella pagina "${result.input?.pageSlug ?? ''}". Nessuna modifica applicata.`,
            input_tokens: htmlUsage?.input_tokens ?? 0,
            output_tokens: htmlUsage?.output_tokens ?? 0,
            cache_read_tokens: htmlUsage?.cache_read_input_tokens ?? 0,
            duration_ms: Date.now() - runStartTime,
          }).catch(() => null)
          // Inject a clear feedback message so the client shows it in chat
          result.input = {
            ...(result.input as Record<string, unknown> ?? {}),
            summary: `⚠️ Non ho trovato l'elemento da modificare. Prova a descrivere meglio il testo esatto del bottone/elemento o indica la sezione della pagina.`,
          }
        } else {
          completeRun(runId, {
            output_summary: `html: ${pages?.length ?? 0} pagine`,
            input_tokens: htmlUsage?.input_tokens ?? 0,
            output_tokens: htmlUsage?.output_tokens ?? 0,
            cache_read_tokens: htmlUsage?.cache_read_input_tokens ?? 0,
            duration_ms: Date.now() - runStartTime,
            output_data: {
              tool: result.tool ?? 'edit_page',
              page_slug: (result.input?.pageSlug ?? result.input?.slug) as string ?? undefined,
              operations_count: opsCount,
              edits_count: editsCount,
              summary: result.input?.summary as string ?? undefined,
              pages_affected: result.tool === 'create_site'
                ? ((result.input?.pages as Array<{slug: string}>) ?? []).map((p) => p.slug)
                : (result.input?.pageSlug ?? result.input?.slug)
                  ? [(result.input?.pageSlug ?? result.input?.slug) as string]
                  : undefined,
              ...(serverHtmlChanged !== undefined ? { html_changed: serverHtmlChanged } : {}),
            },
          }).catch(() => null)
        }
      }

      // Run memory agents in background (non-blocking) — both in parallel
      Promise.all([
        // Structured context (businessName, toneOfVoice, etc.)
        runMemoryAgent(messages, context, apiKey),
        // Session memory MD (design decisions, corrections, structure)
        runSessionMemoryAgent(messages, sessionMemory, apiKey),
      ]).then(async ([updatedContext, updatedMemory]) => {
        if (!updatedContext && !updatedMemory) return
        // Re-read fresh config to avoid lost-update race
        const { data: fresh } = await supabase.from('projects').select('site_config').eq('id', projectId).single()
        const freshConfig = (fresh?.site_config as Record<string, unknown>) ?? siteConfig
        await supabase.from('projects').update({
          site_config: {
            ...freshConfig,
            ...(updatedContext  ? { context: updatedContext }         : {}),
            ...(updatedMemory   ? { sessionMemory: updatedMemory }    : {}),
          },
        }).eq('id', projectId)
      }).catch(() => null)

      // Include _runId so the client can patch html_changed once it applies the edits
      return { ...result, agent: 'html', _runId: runId || undefined }
    }, (err) => runId && failRun(runId, { error_message: String(err).slice(0, 500), duration_ms: Date.now() - runStartTime }).catch(() => null))

  } catch (err) {
    console.error('Chat API error:', err)
    if (runId) {
      failRun(runId, {
        error_message: String(err instanceof Error ? err.message : err).slice(0, 500),
        duration_ms: Date.now() - runStartTime,
      }).catch(() => null)
    }
    if (err instanceof CreditsError) {
      return Response.json({ error: err.message, code: 'INSUFFICIENT_CREDITS', balance: err.balance }, { status: 402 })
    }
    if (err instanceof AnthropicBillingError) {
      return Response.json({ error: 'Servizio temporaneamente non disponibile. Riprova tra qualche minuto.', code: 'SERVICE_UNAVAILABLE' }, { status: 503 })
    }
    if (err instanceof ApiError) {
      return Response.json({ error: err.message }, { status: err.status })
    }
    // Last-resort: check if raw error string contains Anthropic billing signal
    const errStr = String(err)
    if (errStr.includes('credit balance is too low') || errStr.includes('Your credit balance')) {
      return Response.json({ error: 'Servizio temporaneamente non disponibile. Riprova tra qualche minuto.', code: 'SERVICE_UNAVAILABLE' }, { status: 503 })
    }
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
