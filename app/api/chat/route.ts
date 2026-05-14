import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { classify, runFullPipeline, runDesignUpdate, runContentUpdate } from '../../../lib/agents/orchestrator'
import { runHtmlAgent } from '../../../lib/agents/html-agent'
import { runSeoAgent } from '../../../lib/agents/seo-agent'
import { runMemoryAgent, type ProjectContext } from '../../../lib/agents/memory-agent'

export const runtime = 'nodejs'
export const maxDuration = 300

type Page = { slug: string; name: string; html: string }

export async function POST(req: NextRequest) {
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

    // Load project context from DB
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { data: project } = await supabase
      .from('projects')
      .select('site_config')
      .eq('id', projectId)
      .single()

    const siteConfig = (project?.site_config ?? {}) as Record<string, unknown>
    const context: ProjectContext = (siteConfig.context as ProjectContext) ?? {}

    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content ?? ''
    const agent = classify(lastUserMessage, pages?.length > 0)

    if (agent === 'pipeline') {
      const result = await runFullPipeline(lastUserMessage, pages ?? [], apiKey, context)
      if (result.updatedContext) {
        await supabase.from('projects').update({
          site_config: { ...siteConfig, context: result.updatedContext },
        }).eq('id', projectId)
      }
      return Response.json(result)
    }

    if (agent === 'design-update') {
      const result = await runDesignUpdate(lastUserMessage, pages ?? [], apiKey, context)
      return Response.json(result)
    }

    if (agent === 'content-update') {
      const result = await runContentUpdate(lastUserMessage, pages ?? [], apiKey, context)
      return Response.json(result)
    }

    if (agent === 'seo') {
      const result = await runSeoAgent(messages, pages ?? [], customDomain ?? null, apiKey, context)
      return Response.json({ ...result, agent: 'seo' })
    }

    // HTML agent — also update context from conversation
    const result = await runHtmlAgent(messages, pages ?? [], activePageSlug, apiKey)

    // Run memory agent in background (non-blocking)
    runMemoryAgent(messages, context, apiKey).then(async (updatedContext) => {
      if (updatedContext) {
        await supabase.from('projects').update({
          site_config: { ...siteConfig, context: updatedContext },
        }).eq('id', projectId)
      }
    }).catch(() => null)

    return Response.json({ ...result, agent: 'html' })

  } catch (err) {
    console.error('Chat API error:', err)
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
