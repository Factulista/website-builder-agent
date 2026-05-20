import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { classify, runFullPipeline, runDesignUpdate, runContentUpdate } from '../../../lib/agents/orchestrator'
import { runHtmlAgent } from '../../../lib/agents/html-agent'
import { runSeoAgent } from '../../../lib/agents/seo-agent'
import { runMemoryAgent, type ProjectContext } from '../../../lib/agents/memory-agent'
import { runClarifier } from '../../../lib/agents/clarifier'
import { getAgentConfigs, type DbAgentConfig } from '../../../lib/agents/db-config'
import { applyDbOverrides, AGENT_CONFIGS } from '../../../lib/agents/config'
import { startRun, completeRun, failRun } from '../../../lib/agents/run-logger'

export const runtime = 'nodejs'
export const maxDuration = 300

type Page = { slug: string; name: string; html: string }

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
      onError?.(err)
      const error = { type: 'error', error: String(err) }
      controller?.enqueue(encoder.encode(JSON.stringify(error) + '\n'))
      controller?.close()
    })

  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } })
}

export async function POST(req: NextRequest) {
  // Declared outside try so the catch block can call failRun on any error
  let runId = ''
  let runStartTime = Date.now()

  try {
    const { projectId, messages, pages, activePageSlug, customDomain } = await req.json() as {
      projectId: string
      messages: { role: string; content: string }[]
      pages: Page[]
      activePageSlug: string | null
      customDomain?: string | null
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })

    // Load DB agent configs and apply overrides (non-blocking fallback)
    let dbConfigs: DbAgentConfig[] = []
    try {
      dbConfigs = await getAgentConfigs()
      applyDbOverrides(dbConfigs)
    } catch {
      // Fall back to hardcoded configs if DB is unavailable
    }

    // Load project context from DB
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { data: project } = await supabase
      .from('projects')
      .select('site_config, user_id')
      .eq('id', projectId)
      .single()

    const siteConfig = (project?.site_config ?? {}) as Record<string, unknown>
    const context: ProjectContext = (siteConfig.context as ProjectContext) ?? {}
    const mediaMeta = (siteConfig.media ?? {}) as Record<string, { alt?: string; title?: string }>

    // List project media so agents can reference user-uploaded images
    let projectMedia: Array<{ url: string; name: string; alt?: string; title?: string }> = []
    if (project?.user_id) {
      const folder = `${project.user_id}/${projectId}`
      const { data: files } = await supabase.storage.from('project-assets').list(folder, { limit: 100 })
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
    }

    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content ?? ''
    const agent = classify(lastUserMessage, pages?.length > 0)

    // Clarifier — runs before any agent if the request is ambiguous
    const clarifierConfig = dbConfigs.find(c => c.name === 'clarifier')
    const clarifierEnabled = clarifierConfig?.enabled !== false
    if (clarifierEnabled) {
      const clarification = await runClarifier(
        lastUserMessage,
        (pages ?? []).map(p => ({ slug: p.slug, name: p.name })),
        context,
        apiKey,
        agent
      ).catch(() => ({ proceed: true as const }))

      if (!clarification.proceed) {
        return Response.json({
          tool: 'create_site',
          input: { pages: pages ?? [], summary: clarification.message },
          agent,
          steps: [clarification.message],
          requestClarification: true,
        })
      }
    }

    // Check if the html agent is disabled before running html-only requests
    if (agent === 'html' && dbConfigs.length > 0) {
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
    try {
      runId = await startRun({
        project_id: projectId,
        user_id: project?.user_id ?? undefined,
        agent_type: agent,
        input_summary: lastUserMessage.slice(0, 300),
        model: agentModel,
      })
    } catch (runErr) {
      console.error('[run-logger] startRun failed:', String(runErr))
    }

    if (agent === 'pipeline') {
      const startTime = Date.now()
      const encoder = new TextEncoder()

      let streamController: ReadableStreamDefaultController<Uint8Array> | null = null

      const stream = new ReadableStream<Uint8Array>({
        start(controller) { streamController = controller },
      })

      const emit = (step: string) => {
        if (!streamController) return
        const msg: ProgressMessage = {
          type: 'progress',
          step,
          time: formatTime(Date.now() - startTime),
          tokens: 0,
        }
        streamController.enqueue(encoder.encode(encodeMessage(msg)))
      }

      // Esegui il pipeline in background, emettendo progressi real-time
      runFullPipeline(lastUserMessage, pages ?? [], apiKey, context, emit)
        .then(async (result) => {
          if (result.updatedContext) {
            await supabase.from('projects').update({
              site_config: { ...siteConfig, context: result.updatedContext },
            }).eq('id', projectId)
          }
          // Log completion
          if (runId) {
            const usage = result.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } | undefined
            const pageCount = (result.input?.pages?.length ?? 0)
            completeRun(runId, {
              output_summary: `pipeline: ${pageCount} pagine`,
              input_tokens: usage?.input_tokens ?? 0,
              output_tokens: usage?.output_tokens ?? 0,
              cache_read_tokens: usage?.cache_read_input_tokens ?? 0,
              duration_ms: Date.now() - runStartTime,
            }).catch(() => null)
          }
          // Normalize internal links before sending to client
          if (result.input?.pages) result.input.pages = normalizeInternalLinks(result.input.pages)
          const done: DoneMessage = { type: 'done', result }
          streamController?.enqueue(encoder.encode(encodeMessage(done)))
          streamController?.close()
        })
        .catch((err) => {
          if (runId) {
            failRun(runId, {
              error_message: String(err).slice(0, 500),
              duration_ms: Date.now() - runStartTime,
            }).catch(() => null)
          }
          const error = { type: 'error', error: String(err) }
          streamController?.enqueue(encoder.encode(JSON.stringify(error) + '\n'))
          streamController?.close()
        })

      return new Response(stream, {
        headers: { 'Content-Type': 'application/x-ndjson' },
      })
    }

    if (agent === 'design-update') {
      return makeStream(async (emit) => {
        emit('🎨 Aggiornando design su tutte le pagine…')
        const result = await runDesignUpdate(lastUserMessage, pages ?? [], apiKey, context)
        if (result.input?.pages) result.input.pages = normalizeInternalLinks(result.input.pages)
        // Salva il design system aggiornato nel contesto del progetto
        if (result.updatedContext) {
          await supabase.from('projects').update({
            site_config: { ...siteConfig, context: result.updatedContext },
          }).eq('id', projectId)
        }
        if (runId) {
          const usage = result.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } | undefined
          completeRun(runId, {
            output_summary: `design-update: ${result.input?.pages?.length ?? 0} pagine`,
            input_tokens: usage?.input_tokens ?? 0,
            output_tokens: usage?.output_tokens ?? 0,
            cache_read_tokens: usage?.cache_read_input_tokens ?? 0,
            duration_ms: Date.now() - runStartTime,
          }).catch(() => null)
        }
        return result
      }, (err) => runId && failRun(runId, { error_message: String(err).slice(0, 500), duration_ms: Date.now() - runStartTime }).catch(() => null))
    }

    if (agent === 'content-update') {
      return makeStream(async (emit) => {
        emit('✍️ Riscrivendo i testi su tutte le pagine…')
        const result = await runContentUpdate(lastUserMessage, pages ?? [], apiKey, context)
        if (result.input?.pages) result.input.pages = normalizeInternalLinks(result.input.pages)
        if (runId) {
          const usage = result.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } | undefined
          completeRun(runId, {
            output_summary: `content-update: ${result.input?.pages?.length ?? 0} pagine`,
            input_tokens: usage?.input_tokens ?? 0,
            output_tokens: usage?.output_tokens ?? 0,
            cache_read_tokens: usage?.cache_read_input_tokens ?? 0,
            duration_ms: Date.now() - runStartTime,
          }).catch(() => null)
        }
        return result
      }, (err) => runId && failRun(runId, { error_message: String(err).slice(0, 500), duration_ms: Date.now() - runStartTime }).catch(() => null))
    }

    if (agent === 'seo') {
      return makeStream(async (emit) => {
        emit('🔍 Ottimizzando SEO e meta tag…')
        const result = await runSeoAgent(messages, pages ?? [], customDomain ?? null, apiKey, context)
        if (runId) {
          const usage = result.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } | undefined
          completeRun(runId, {
            output_summary: `seo: ${pages?.length ?? 0} pagine`,
            input_tokens: usage?.input_tokens ?? 0,
            output_tokens: usage?.output_tokens ?? 0,
            cache_read_tokens: usage?.cache_read_input_tokens ?? 0,
            duration_ms: Date.now() - runStartTime,
          }).catch(() => null)
        }
        return { ...result, agent: 'seo' }
      }, (err) => runId && failRun(runId, { error_message: String(err).slice(0, 500), duration_ms: Date.now() - runStartTime }).catch(() => null))
    }

    // HTML agent — also update context from conversation
    return makeStream(async (emit) => {
      emit('✏️ Elaborando la modifica…')
      const contextLogo = context.design?.tokens?.logo
      const result = await runHtmlAgent(messages, pages ?? [], activePageSlug, apiKey, projectMedia, contextLogo)

      // Normalize internal links on create_site and add_page (edit_page is fine — it's surgical)
      if (result.tool === 'create_site' && result.input?.pages) {
        result.input.pages = normalizeInternalLinks(result.input.pages as Page[])
      }
      if (result.tool === 'add_page' && result.input?.html) {
        const normalized = normalizeInternalLinks([{ slug: result.input.slug as string, name: result.input.name as string, html: result.input.html as string }, ...(pages ?? [])])
        result.input.html = normalized[0].html
      }

      if (runId) {
        const usage = result.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } | undefined
        completeRun(runId, {
          output_summary: `html: ${pages?.length ?? 0} pagine`,
          input_tokens: usage?.input_tokens ?? 0,
          output_tokens: usage?.output_tokens ?? 0,
          cache_read_tokens: usage?.cache_read_input_tokens ?? 0,
          duration_ms: Date.now() - runStartTime,
        }).catch(() => null)
      }

      // Run memory agent in background (non-blocking)
      runMemoryAgent(messages, context, apiKey).then(async (updatedContext) => {
        if (updatedContext) {
          await supabase.from('projects').update({
            site_config: { ...siteConfig, context: updatedContext },
          }).eq('id', projectId)
        }
      }).catch(() => null)

      return { ...result, agent: 'html' }
    }, (err) => runId && failRun(runId, { error_message: String(err).slice(0, 500), duration_ms: Date.now() - runStartTime }).catch(() => null))

  } catch (err) {
    console.error('Chat API error:', err)
    // Log the error run if a run was started
    if (runId) {
      failRun(runId, {
        error_message: String(err).slice(0, 500),
        duration_ms: Date.now() - runStartTime,
      }).catch(() => null)
    }
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
