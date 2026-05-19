import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { callClaude } from '../../../lib/agents/config'
import { runHtmlAgent } from '../../../lib/agents/html-agent'
import { SEO_KNOWLEDGE } from '../../../lib/agents/knowledge/seo'
import { buildContextPrompt, type ProjectContext } from '../../../lib/agents/memory-agent'
import { buildFixPrompt } from '../../../lib/seo/prompt-builder'
import { getCheck } from '../../../lib/seo/checks'
import type { CheckId } from '../../../lib/seo/checks'
import type { CheckResult } from '../../../lib/seo/analyzer'

export const runtime = 'nodejs'
export const maxDuration = 120

type Page = { slug: string; name: string; html: string }

function enc(msg: object, encoder: TextEncoder): Uint8Array {
  return encoder.encode(JSON.stringify(msg) + '\n')
}

// ── SEO content generator (for seo-owner checks) ─────────────────────────────
// Calls a single-shot SEO agent to generate the content (new title, description, etc.)
// then returns the generated string so the html agent can inject it.

async function generateSeoContent(
  seoPrompt: string,
  pageHtml: string,
  apiKey: string,
  context: ProjectContext
): Promise<string> {
  const system = `Sei un SEO expert. Generi contenuti ottimizzati per i motori di ricerca.

${SEO_KNOWLEDGE}

${buildContextPrompt(context)}

Rispondi con SOLO il contenuto richiesto — nessuna spiegazione, nessun markdown, nessun tag HTML salvo quando esplicitamente richiesto.`

  const res = await callClaude(
    'seo',
    system,
    [
      {
        role: 'user',
        content: `${seoPrompt}\n\nHTML DELLA PAGINA (per contesto):\n${pageHtml.slice(0, 4000)}`,
      },
    ],
    [],  // no tools — just ask for raw text output
    apiKey
  )

  if (!res.ok) throw new Error(`SEO content API error: ${await res.text()}`)
  const data = await res.json()
  // Extract text from response (no tool use — it's a raw text response)
  const textBlock = data.content?.find((b: { type: string }) => b.type === 'text')
  return textBlock?.text?.trim() ?? ''
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(c) { controller = c },
  })

  const emit = (step: string, time: string) => {
    controller?.enqueue(enc({ type: 'progress', step, time, tokens: 0 }, encoder))
  }
  const emitDone = (result: object) => {
    controller?.enqueue(enc({ type: 'done', result }, encoder))
    controller?.close()
  }
  const emitError = (error: string) => {
    controller?.enqueue(enc({ type: 'error', error }, encoder))
    controller?.close()
  }

  const startTime = Date.now()
  const elapsed = () => {
    const ms = Date.now() - startTime
    const s = Math.floor(ms / 1000)
    return s > 0 ? `${s}s` : '0s'
  }

  ;(async () => {
    try {
      const {
        projectId,
        pageSlug,
        checkId,
        checkResult,
        pages,
        customDomain,
      } = await req.json() as {
        projectId: string
        pageSlug: string
        checkId: CheckId
        checkResult: CheckResult
        pages: Page[]
        customDomain?: string | null
      }

      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) { emitError('ANTHROPIC_API_KEY non configurata'); return }

      // Load project context
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )
      const { data: project } = await supabase
        .from('projects')
        .select('site_config, slug')
        .eq('id', projectId)
        .single()

      const siteConfig = (project?.site_config ?? {}) as Record<string, unknown>
      const context: ProjectContext = (siteConfig.context as ProjectContext) ?? {}
      const projectSlug = project?.slug ?? ''

      const check = getCheck(checkId)
      const targetPage = pages.find(p => p.slug === pageSlug)
      if (!targetPage) { emitError(`Pagina "${pageSlug}" non trovata`); return }

      // Build fix prompts
      const fixPrompt = buildFixPrompt(checkId, targetPage, checkResult, {
        customDomain,
        projectSlug,
        language: context.language,
        businessName: context.businessName,
        businessType: context.businessType,
      })

      let agentPrompt = fixPrompt.agentPrompt

      // ── SEO-owner checks: generate content first ──────────────────────────
      if (check.fixOwner === 'seo' && fixPrompt.seoAgentPrompt) {
        emit(`🔍 Generando contenuto SEO per "${check.label}"…`, elapsed())

        const generated = await generateSeoContent(
          fixPrompt.seoAgentPrompt,
          targetPage.html,
          apiKey,
          context
        )

        if (!generated) { emitError('Il SEO agent non ha generato contenuto'); return }

        // Inject generated content into the html agent prompt
        agentPrompt = agentPrompt
          .replace('[NUOVO_TITLE]', generated)
          .replace('[NUOVA_DESCRIPTION]', generated)
          .replace('[NUOVO_H1]', generated)
          .replace('[OG_TAGS]', generated)
          .replace('[ALT_TEXTS]', generated)
          .replace('[SCHEMA_JSON]', generated)
      }

      // ── HTML agent: apply the fix ──────────────────────────────────────────
      emit(`✏️ Applicando fix: ${check.label}…`, elapsed())

      const contextLogo = context.design?.tokens?.logo

      // Build a fake messages array so runHtmlAgent can be reused
      const messages = [{ role: 'user', content: agentPrompt }]

      const result = await runHtmlAgent(
        messages,
        pages,
        pageSlug,
        apiKey,
        [],  // no project media needed for SEO fixes
        contextLogo
      )

      if (!result) { emitError('HTML agent non ha restituito un risultato'); return }

      // Apply the edit to the pages array
      let updatedPages = [...pages]

      if (result.tool === 'edit_page') {
        const { pageSlug: editedSlug, edits } = result.input as {
          pageSlug: string
          edits: { find: string; replace: string }[]
        }
        updatedPages = pages.map(p => {
          if (p.slug !== editedSlug) return p
          let html = p.html
          for (const edit of edits) {
            if (html.includes(edit.find)) {
              html = html.replace(edit.find, edit.replace)
            }
          }
          return { ...p, html }
        })
      } else if (result.tool === 'create_site' && result.input?.pages) {
        updatedPages = result.input.pages as Page[]
      }

      // Persist updated pages to DB
      const { data: currentProject } = await supabase
        .from('projects')
        .select('site_config')
        .eq('id', projectId)
        .single()

      const currentConfig = (currentProject?.site_config ?? {}) as Record<string, unknown>
      await supabase.from('projects').update({
        site_config: { ...currentConfig, pages: updatedPages },
        updated_at: new Date().toISOString(),
      }).eq('id', projectId)

      emitDone({
        tool: 'seo_fix',
        checkId,
        updatedPages,
        summary: `✅ ${check.label} ottimizzato`,
      })
    } catch (err) {
      emitError(String(err))
    }
  })()

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  })
}
